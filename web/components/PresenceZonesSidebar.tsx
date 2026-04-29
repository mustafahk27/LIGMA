import { usePresenceZones } from '@/lib/use-presence-zones';
import type { NodeSnapshot } from '@/lib/node-types';

interface PresenceZonesSidebarProps {
  nodes: NodeSnapshot[];
  onJump: (x: number, y: number) => void;
}

export function PresenceZonesSidebar({ nodes, onJump }: PresenceZonesSidebarProps) {
  const { zones, outside } = usePresenceZones(nodes);

  return (
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col gap-4">
      {zones.length === 0 && (
        <div className="text-center py-8">
          <p className="text-xs text-[var(--text-3)]">No zones defined yet.</p>
          <p className="text-xs text-[var(--text-3)] mt-2 max-w-[200px] mx-auto">
            Use the <strong className="text-[var(--text-2)]">Zone Tool (Z)</strong> to draw labeled regions on the canvas.
          </p>
        </div>
      )}

      {zones.map(({ zone, users }) => (
        <div key={zone.id} className="card p-3 animate-fade-in border border-[var(--border)] bg-[var(--surface-2)]">
          <div 
            className="flex items-center justify-between cursor-pointer group"
            onClick={() => onJump(zone.x + zone.width / 2, zone.y + zone.height / 2)}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[14px] flex-shrink-0">📍</span>
              <h3 className="text-xs font-semibold text-[var(--text)] truncate group-hover:text-[var(--accent)] transition-colors">
                {zone.content || 'Unnamed Zone'}
              </h3>
            </div>
            <span className="text-[10px] text-[var(--text-3)] font-medium">
              {users.length} {users.length === 1 ? 'user' : 'users'}
            </span>
          </div>

          {users.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-2 pl-2">
                  <div 
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: u.color }}
                  >
                    {u.name[0]?.toUpperCase()}
                  </div>
                  <span className="text-xs text-[var(--text-2)] truncate">
                    {u.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {outside.length > 0 && (
        <div className="mt-4 pt-4 border-t border-[var(--border)]">
          <h3 className="text-xs font-medium text-[var(--text-3)] uppercase tracking-wider mb-3 px-1">
            Outside Any Zone
          </h3>
          <div className="flex flex-col gap-2">
            {outside.map((u) => (
              <div key={u.id} className="flex items-center gap-2 pl-1 opacity-70">
                <div 
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: u.color }}
                >
                  {u.name[0]?.toUpperCase()}
                </div>
                <span className="text-xs text-[var(--text-2)] truncate">
                  {u.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
