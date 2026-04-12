type TabName = 'chat' | 'notes' | 'settings'

export function BottomNav({
  active,
  onChange,
}: {
  active: TabName
  onChange: (tab: TabName) => void
}) {
  return (
    <nav className="web-bottom-nav">
      <button className={active === 'chat' ? 'active' : ''} onClick={() => onChange('chat')}>会话</button>
      <button className={active === 'notes' ? 'active' : ''} onClick={() => onChange('notes')}>随笔</button>
      <button className={active === 'settings' ? 'active' : ''} onClick={() => onChange('settings')}>设置</button>
    </nav>
  )
}
