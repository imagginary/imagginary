// SECURITY MODEL: This app uses Supabase Realtime broadcast only — no tables,
// no storage, no RLS applicable (broadcast channels are not table-backed and
// RLS doesn't govern them). Access control is entirely "possession of the
// Supabase URL + anon key + project_id". The mitigation is user-facing:
// invite links are framed as sensitive (like a shared doc link), and Settings
// provides a one-click path to regenerate the anon key, which invalidates
// all existing invite links instantly.
//
// KNOWN LIMITATION: No handling for Supabase Realtime rate limits
// (free tier: ~200 concurrent connections, ~100 msg/sec per channel) and
// no schema versioning on broadcast payloads. Both are deferred until
// real-world usage patterns or a breaking schema change make them necessary.

import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { Project } from '../types';
import { settingsService } from './SettingsService';

export type SharedStudioEvent =
  | { type: 'project_update'; project: Project; userId: string }
  | { type: 'user_joined'; userId: string; userName: string }
  | { type: 'user_left'; userId: string }
  | { type: 'cursor'; userId: string; userName: string; panelId: string | null; x: number; y: number }
  | { type: 'request_state'; userId: string }
  | { type: 'state_response'; userId: string; targetUserId: string; project: Project };

export type SharedStudioConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

class SharedStudioService {
  private client: SupabaseClient | null = null;
  private cachedCredentials: { url: string; key: string } | null = null;
  private channel: RealtimeChannel | null = null;
  private userId: string = `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  private userName: string = 'Anonymous';
  private projectId: string | null = null;
  private onEventCallback: ((event: SharedStudioEvent) => void) | null = null;
  private connectionStatus: SharedStudioConnectionStatus = 'disconnected';
  private onConnectionStatusChange?: (status: SharedStudioConnectionStatus) => void;
  // Stored for reconnect — set on joinProject, cleared on leaveProject
  private _reconnectProjectId: string | null = null;
  private _reconnectGetCurrentProject: (() => Project | null) | null = null;

  isConfigured(): boolean {
    const s = settingsService.get();
    return !!(s.supabaseUrl && s.supabaseAnonKey);
  }

  isConnected(): boolean {
    return this.channel !== null;
  }

  setUserName(name: string): void {
    this.userName = name;
  }

  setConnectionStatusListener(cb: (status: SharedStudioConnectionStatus) => void): void {
    this.onConnectionStatusChange = cb;
  }

  getConnectionStatus(): SharedStudioConnectionStatus {
    return this.connectionStatus;
  }

  private async attemptReconnect(): Promise<void> {
    if (!this._reconnectProjectId || !this.onEventCallback) return;
    if (this.connectionStatus === 'connected') return;
    this.connectionStatus = 'reconnecting';
    this.onConnectionStatusChange?.('reconnecting');
    try {
      // leaveProject clears reconnect fields — snapshot before calling
      const projectId = this._reconnectProjectId;
      const getCurrentProject = this._reconnectGetCurrentProject;
      const onEvent = this.onEventCallback;
      await this.leaveProject();
      await this.joinProject(projectId, onEvent, getCurrentProject ?? (() => null));
    } catch {
      setTimeout(() => this.attemptReconnect(), 8000);
    }
  }

  private getClient(): SupabaseClient | null {
    const s = settingsService.get();
    if (!s.supabaseUrl || !s.supabaseAnonKey) return null;
    // Re-create client if no client exists yet, or if credentials have changed since
    // the client was last created (e.g. a deep-link join saved a new supabaseUrl).
    if (
      !this.client ||
      this.cachedCredentials?.url !== s.supabaseUrl ||
      this.cachedCredentials?.key !== s.supabaseAnonKey
    ) {
      this.client = createClient(s.supabaseUrl, s.supabaseAnonKey);
      this.cachedCredentials = { url: s.supabaseUrl, key: s.supabaseAnonKey };
    }
    return this.client;
  }

  /** Strip large binary fields before broadcasting to stay within Supabase Realtime's
   *  32KB per-message limit (free tier). Only base64 data blobs are stripped.
   *  Path/URL strings (voicePath, lipSyncPath) are kept so collaborators know that
   *  voice and lip-sync assets exist for a panel, even if they can't access the files. */
  private stripBinaryFields(project: Project): Project {
    return {
      ...project,
      panels: project.panels.map(panel => ({
        ...panel,
        generatedImageData: undefined,  // base64 PNG — large
        motionClipData: undefined,      // base64 video — large
        poseClipData: undefined,        // base64 video — large
        lipSyncData: undefined,         // base64 video — large
        editHistory: [],                // array of base64 strings — large
        revisions: [],                  // cross-session history — potentially large
        // voicePath:   kept — absolute file path string, tiny
        // lipSyncPath: kept — URL/path string, tiny
      })),
    };
  }

  async joinProject(
    projectId: string,
    onEvent: (event: SharedStudioEvent) => void,
    getCurrentProject: () => Project | null = () => null,
  ): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    // Leave existing channel first
    await this.leaveProject();

    this.projectId = projectId;
    this.onEventCallback = onEvent;

    this.channel = client.channel(`project:${projectId}`, {
      config: { broadcast: { self: false } },
    });

    this.channel.on('broadcast', { event: 'project_update' }, ({ payload }) => {
      onEvent({
        type: 'project_update',
        project: payload.project as Project,
        userId: payload.userId as string,
      });
    });

    this.channel.on('broadcast', { event: 'cursor' }, ({ payload }) => {
      onEvent({
        type: 'cursor',
        userId: payload.userId as string,
        userName: payload.userName as string,
        panelId: payload.panelId as string | null,
        x: payload.x as number,
        y: payload.y as number,
      });
    });

    // When another user asks for current state, respond with the live project.
    // getCurrentProject() is called at request time (not at join time) so late
    // joiners always receive the current state, not a snapshot frozen at session start.
    this.channel.on('broadcast', { event: 'request_state' }, ({ payload }) => {
      if (payload.userId === this.userId) return; // ignore our own broadcast
      const liveProject = getCurrentProject();
      if (!liveProject) return;
      this.channel?.send({
        type: 'broadcast',
        event: 'state_response',
        payload: {
          type: 'state_response',
          userId: this.userId,
          targetUserId: payload.userId,
          project: this.stripBinaryFields(liveProject),
        },
      });
    });

    this.channel.on('broadcast', { event: 'state_response' }, ({ payload }) => {
      onEvent({
        type: 'state_response',
        userId: payload.userId as string,
        targetUserId: payload.targetUserId as string,
        project: payload.project as Project,
      });
    });

    this.channel.on('presence', { event: 'join' }, ({ newPresences }) => {
      (newPresences as Array<{ userId: string; userName: string }>).forEach((p) => {
        if (p.userId !== this.userId) {
          onEvent({ type: 'user_joined', userId: p.userId, userName: p.userName });
        }
      });
    });

    this.channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      (leftPresences as Array<{ userId: string }>).forEach((p) => {
        onEvent({ type: 'user_left', userId: p.userId });
      });
    });

    // Store for reconnect before the async subscribe resolves.
    // We store the getter (not a snapshot) so reconnects always send live project state.
    this._reconnectProjectId = projectId;
    this._reconnectGetCurrentProject = getCurrentProject;

    await new Promise<void>((resolve) => {
      let resolved = false;
      this.channel!.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          this.connectionStatus = 'connected';
          this.onConnectionStatusChange?.('connected');
          await this.channel!.track({
            userId: this.userId,
            userName: this.userName,
            joinedAt: Date.now(),
          });
          if (!resolved) { resolved = true; resolve(); }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.connectionStatus = 'disconnected';
          this.onConnectionStatusChange?.('disconnected');
          if (!resolved) { resolved = true; resolve(); }
          setTimeout(() => this.attemptReconnect(), 3000);
        } else if (status === 'CLOSED') {
          this.connectionStatus = 'disconnected';
          this.onConnectionStatusChange?.('disconnected');
        }
      });
    });

    // Ask existing collaborators for current project state
    await this.channel.send({
      type: 'broadcast',
      event: 'request_state',
      payload: { type: 'request_state', userId: this.userId },
    });

    return true;
  }

  async broadcastProjectUpdate(project: Project): Promise<void> {
    if (!this.channel) return;
    await this.channel.send({
      type: 'broadcast',
      event: 'project_update',
      payload: { project: this.stripBinaryFields(project), userId: this.userId },
    });
  }

  broadcastCursor(panelId: string | null, x: number, y: number): void {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event: 'cursor',
      payload: { userId: this.userId, userName: this.userName, panelId, x, y },
    });
  }

  isInSession(): boolean {
    return this.channel !== null;
  }

  async leaveProject(): Promise<void> {
    if (this.channel) {
      await this.channel.untrack();
      await this.channel.unsubscribe();
      this.channel = null;
    }
    this.projectId = null;
    this.onEventCallback = null;
    this._reconnectProjectId = null;
    this._reconnectCurrentProject = null;
    this.connectionStatus = 'disconnected';
  }

  getUserId(): string { return this.userId; }
  getProjectId(): string | null { return this.projectId; }
}

export const sharedStudioService = new SharedStudioService();
