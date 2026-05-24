import React from 'react';
import { Users, Link, LogOut } from 'lucide-react';
import { sharedStudioService } from '../services/SharedStudioService';

interface SessionUser {
  userId: string;
  userName: string;
}

interface Props {
  projectId: string;
  users: SessionUser[];
  onInvite: () => void;
  onLeave: () => void;
}

function UserAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const colors = [
    'bg-violet-600', 'bg-imagginary-600', 'bg-teal-600',
    'bg-rose-600', 'bg-amber-600', 'bg-sky-600',
  ];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div
      className={`w-6 h-6 rounded-full ${color} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}
      title={name}
    >
      {initials}
    </div>
  );
}

export default function SharedStudioPanel({ projectId, users, onInvite, onLeave }: Props) {
  const myId = sharedStudioService.getUserId();
  const others = users.filter((u) => u.userId !== myId);
  const shown = others.slice(0, 5);
  const overflow = others.length - 5;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-green-950/40 border-b border-green-900/40">
      {/* Live indicator */}
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
        <span className="text-[10px] font-semibold text-green-400 uppercase tracking-wide">Live</span>
        <span className="text-[10px] text-green-700">· Shared Session</span>
      </div>

      <div className="w-px h-3 bg-green-900" />

      {/* User avatars */}
      <div className="flex items-center -space-x-1">
        {/* Self */}
        <div
          className="w-6 h-6 rounded-full bg-imagginary-700 flex items-center justify-center text-[9px] font-bold text-white ring-1 ring-green-950/40 shrink-0"
          title="You"
        >
          Me
        </div>
        {shown.map((u) => (
          <div key={u.userId} className="ring-1 ring-green-950/40 rounded-full">
            <UserAvatar name={u.userName} />
          </div>
        ))}
        {overflow > 0 && (
          <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-[9px] text-gray-300 ring-1 ring-green-950/40">
            +{overflow}
          </div>
        )}
      </div>

      {others.length > 0 && (
        <span className="text-[10px] text-green-700">
          {others.length} teammate{others.length !== 1 ? 's' : ''} online
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={onInvite}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-green-400 hover:text-green-300 hover:bg-green-900/30 transition-colors"
          title="Copy invite link"
        >
          <Link className="w-3 h-3" />
          Invite
        </button>
        <button
          onClick={onLeave}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          title="Leave shared session"
        >
          <LogOut className="w-3 h-3" />
          Leave
        </button>
      </div>
    </div>
  );
}
