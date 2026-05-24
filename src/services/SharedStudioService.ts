import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { Project } from '../types';
import { settingsService } from './SettingsService';

export type SharedStudioEvent =
  | { type: 'project_update'; project: Project; userId: string }
  | { type: 'user_joined'; userId: string; userName: string }
  | { type: 'user_left'; userId: string }
  | { type: 'cursor'; userId: string; panelId: string | null };

class SharedStudioService {
  private client: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private userId: string = `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  private userName: string = 'Anonymous';
  private projectId: string | null = null;
  private onEventCallback: ((event: SharedStudioEvent) => void) | null = null;

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

  private getClient(): SupabaseClient | null {
    const s = settingsService.get();
    if (!s.supabaseUrl || !s.supabaseAnonKey) return null;
    // Re-create client if credentials changed
    if (!this.client) {
      this.client = createClient(s.supabaseUrl, s.supabaseAnonKey);
    }
    return this.client;
  }

  async joinProject(
    projectId: string,
    onEvent: (event: SharedStudioEvent) => void
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
        panelId: payload.panelId as string | null,
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

    await new Promise<void>((resolve) => {
      this.channel!.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.channel!.track({
            userId: this.userId,
            userName: this.userName,
            joinedAt: Date.now(),
          });
          resolve();
        }
      });
    });

    return true;
  }

  async broadcastProjectUpdate(project: Project): Promise<void> {
    if (!this.channel) return;
    await this.channel.send({
      type: 'broadcast',
      event: 'project_update',
      payload: { project, userId: this.userId },
    });
  }

  async broadcastCursor(panelId: string | null): Promise<void> {
    if (!this.channel) return;
    await this.channel.send({
      type: 'broadcast',
      event: 'cursor',
      payload: { userId: this.userId, panelId },
    });
  }

  async leaveProject(): Promise<void> {
    if (this.channel) {
      await this.channel.untrack();
      await this.channel.unsubscribe();
      this.channel = null;
    }
    this.projectId = null;
    this.onEventCallback = null;
  }

  getUserId(): string { return this.userId; }
  getProjectId(): string | null { return this.projectId; }
}

export const sharedStudioService = new SharedStudioService();
