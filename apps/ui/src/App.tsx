export function App() {
  return (
    <div data-testid="app-shell" className="h-screen grid" style={{ gridTemplateColumns: "240px 1fr 300px" }}>
      <aside className="border-r border-hairline p-4"><h1 className="font-display text-xl">FleetView</h1></aside>
      <main className="relative" />
      <aside className="border-l border-hairline p-4" />
    </div>
  );
}
