import { useState, useMemo } from "react";
import { Doughnut, Line, Bar } from "react-chartjs-2";
import "../src/lib/charts"; 

const API = import.meta.env.VITE_API_BASE;

//kept inline to stay one page
function parseGithubUrl(input) {
  if (!input) return null;
  let s = String(input).trim();

  s = s.replace(/["'“”‘’]/g, "");   // quotes
  s = s.replace(/\s+$/g, "");       // spaces
  s = s.replace(/go$/i, "");       

  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, "");

  const parts = s.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { kind: "user", owner: parts[0] };
  if (parts.length >= 2) return { kind: "repo", owner: parts[0], repo: parts[1] };
  return null;
}

function sumLanguages(langMaps) {
  const totals = {};
  langMaps.forEach(m => Object.entries(m).forEach(([k,v]) => totals[k]=(totals[k]||0)+v));
  return totals;
}
function commitsByDay(commits) {
  const map = new Map();
  commits.forEach(c=>{
    const d = new Date(c.commit.author.date).toISOString().slice(0,10);
    map.set(d,(map.get(d)||0)+1);
  });
  const arr = [...map.entries()].sort(([a],[b])=>a.localeCompare(b));
  return { labels: arr.map(a=>a[0]), data: arr.map(a=>a[1]) };
}
function issueStats(items) {
  let openIssues=0, closedIssues=0, openPRs=0, closedPRs=0;
  items.forEach(i=>{
    const isPR = !!i.pull_request;
    const closed = i.state === "closed";
    if (isPR) closed ? closedPRs++ : openPRs++;
    else closed ? closedIssues++ : openIssues++;
  });
  return { openIssues, closedIssues, openPRs, closedPRs };
}
//chart colors
const PALETTE = [
  "#6366F1", "#10B981", "#F59E0B", "#F43F5E", "#06B6D4",
  "#A78BFA", "#22C55E", "#3B82F6", "#E11D48", "#14B8A6"
];
const colorsFor = (n) => Array.from({ length: n }, (_, i) => PALETTE[i % PALETTE.length]);
const withAlpha = (hex, a) => {
  const [r,g,b] = hex.replace("#","").match(/.{2}/g).map(x=>parseInt(x,16));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};


export default function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState(null);    
  const [langTotals, setLangTotals] = useState(null);
  const [commitSeries, setCommitSeries] = useState(null);
  const [mixStats, setMixStats] = useState(null);

  const kpis = useMemo(()=>{
    if (!view) return null;
    if (view.kind === "repo") {
      const r = view.repo;
      return [
        { label:"Stars", value:r.stargazers_count },
        { label:"Forks", value:r.forks_count },
        { label:"Open Issues", value:r.open_issues_count },
        { label:"Last Push", value:new Date(r.pushed_at).toLocaleDateString() },
      ];
    } else {
      const repos = view.repos||[];
      const stars = repos.reduce((a,r)=>a+(r.stargazers_count||0),0);
      const forks = repos.reduce((a,r)=>a+(r.forks_count||0),0);
      const last = repos.reduce((d,r)=>!d||new Date(r.pushed_at)>new Date(d)?r.pushed_at:d,null);
      return [
        { label:"Total Repos", value:repos.length },
        { label:"Total Stars", value:stars },
        { label:"Total Forks", value:forks },
        { label:"Last Activity", value:last?new Date(last).toLocaleDateString():"—" },
      ];
    }
  }, [view]);

  const onGo = async () => {
    setErr("");
    setView(null);
    setLangTotals(null);
    setCommitSeries(null);
    setMixStats(null);

    const parsed = parseGithubUrl(url);
    if (!parsed) { setErr("Paste a valid GitHub profile or repo URL"); return; }

    setLoading(true);
    try {
      if (parsed.kind === "user") {
        const [uR, rR] = await Promise.all([
          fetch(`${API}/api/user/${parsed.owner}`),
          fetch(`${API}/api/repos/${parsed.owner}`)
        ]);
        const [user, repos] = [await uR.json(), await rR.json()];
        setView({ kind:"user", user, repos });

        // languages top 6 repos by stars
        const top = (repos||[]).sort((a,b)=>(b.stargazers_count||0)-(a.stargazers_count||0)).slice(0,6);
        const langs = await Promise.all(top.map(r =>
          fetch(`${API}/api/repo/${r.owner.login}/${r.name}/languages`).then(x=>x.json())
        ));
        setLangTotals(sumLanguages(langs));

        // issues mix 
        if (top[0]) {
          const iR = await fetch(`${API}/api/repo/${top[0].owner.login}/${top[0].name}/issues?state=all&per_page=100`);
          const iJ = await iR.json();
          setMixStats(issueStats(Array.isArray(iJ)?iJ:[]));
        }

      } else {
        // get repo details via GitHub HTML link
        const rList = await fetch(`${API}/api/repos/${parsed.owner}`).then(x=>x.json());
        const repo = rList.find(r => r.name.toLowerCase() === parsed.repo.toLowerCase());
        if (!repo) throw new Error("Repo not found in owner’s public repos");

        setView({ kind:"repo", repo });

        const [langs, issues] = await Promise.all([
          fetch(`${API}/api/repo/${parsed.owner}/${parsed.repo}/languages`).then(x=>x.json()),
          fetch(`${API}/api/repo/${parsed.owner}/${parsed.repo}/issues?state=all&per_page=100`).then(x=>x.json()),
        ]);
        setLangTotals(langs);
        setMixStats(issueStats(Array.isArray(issues)?issues:[]));

        const since = new Date(Date.now()-90*24*3600*1000).toISOString();
        const commits = await fetch(`${API}/api/repo/${parsed.owner}/${parsed.repo}/commits?since=${encodeURIComponent(since)}`).then(x=>x.json());
        setCommitSeries(commitsByDay(Array.isArray(commits)?commits:[]));
      }
    } catch (e) {
      setErr(e.message || "Load failed");
    } finally {
      setLoading(false);
    }
  };

  const doughnutData = useMemo(() => {
    if (!langTotals) return null;
    const labels = Object.keys(langTotals);
    const values = Object.values(langTotals);
    const bg = colorsFor(labels.length);
    return {
      labels,
      datasets: [{
        data: values,
        backgroundColor: bg,
        hoverBackgroundColor: bg.map(c => withAlpha(c, 0.85)),
        borderColor: "#fff",
        borderWidth: 2
      }]
    };
  }, [langTotals]);  

  const lineData = useMemo(() => {
    if (!commitSeries) return null;
    const base = "#6366F1"; 
    return {
      labels: commitSeries.labels,
      datasets: [{
        label: "Commits (90d)",
        data: commitSeries.data,
        tension: 0.35,
        fill: true,
        borderColor: base,
        backgroundColor: withAlpha(base, 0.2),
        pointRadius: 0,
        borderWidth: 2
      }]
    };
  }, [commitSeries]);  
  const barData = useMemo(() => {
    if (!mixStats) return null;
    const labels = ["Open Issues","Closed Issues","Open PRs","Closed PRs"];
    const vals = [mixStats.openIssues, mixStats.closedIssues, mixStats.openPRs, mixStats.closedPRs];
    const cols = ["#F59E0B","#10B981","#3B82F6","#EF4444"]; // amber, emerald, blue, red
    return { labels, datasets: [{ data: vals, backgroundColor: cols, borderRadius: 8 }] };
  }, [mixStats]);  

  return (
    <div className="min-h-screen bg-slate-800 text-zinc-300">
      <div className="mx-auto max-w-7xl p-4 space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-semibold">Portfolio Insights</h1>
          <div className="flex w-full gap-2 sm:w-auto">
            <input
              className="flex-1 rounded-xl border px-3 py-2 text-black"
              placeholder="Paste GitHub link (profile or repo)"
              value={url}
              onChange={e=>setUrl(e.target.value)}
            />
            <button onClick={onGo} className="rounded-xl px-4 py-2 bg-indigo-200 text-black disabled:opacity-50" disabled={loading}>
              {loading ? "Loading…" : "Go"}
            </button>
          </div>
        </header>

        {err && <p className="text-red-600">{err}</p>}

        {view && (
          <>
            {kpis && (
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {kpis.map(k=>(
                  <div key={k.label} className="rounded-2xl border p-4 shadow-sm bg-sky-800/70">
                    <p className="text-sm text-zinc-100">{k.label}</p>
                    <p className="mt-2 text-2xl font-semibold">{k.value ?? "—"}</p>
                  </div>
                ))}
              </section>
            )}

            <section className="rounded-2xl border p-4">
              {view.kind === "repo" ? (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">{view.repo.full_name}</h2>
                    <p className="text-sm text-zinc-100">{view.repo.description || "—"}</p>
                  </div>
                  <a className="text-sm underline" href={view.repo.html_url} target="_blank" rel="noreferrer">Open on GitHub</a>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">@{view.user.login}</h2>
                    <p className="text-sm text-zinc-100">{view.user.bio || "—"}</p>
                  </div>
                  <a className="text-sm underline" href={view.user.html_url} target="_blank" rel="noreferrer">Open on GitHub</a>
                </div>
              )}
            </section>

            {/* Charts */}
            <section className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border p-4">
                <h3 className="mb-3 font-medium">Language Breakdown</h3>
                {doughnutData ? <Doughnut data={doughnutData} options={{ plugins:{ legend:{ position:"bottom"} } }} /> : <p className="text-sm text-zinc-500">No language data yet.</p>}
              </div>

              <div className="rounded-2xl border p-4">
                <h3 className="mb-3 font-medium">Commits (Last 90 Days)</h3>
                {lineData ? <Line data={lineData} options={{ plugins:{ legend:{ display:false } } }} /> : <p className="text-sm text-zinc-500">Load a repo to see commits.</p>}
              </div>

              <div className="rounded-2xl border p-4 lg:col-span-2">
                <h3 className="mb-3 font-medium">Issues vs Pull Requests</h3>
                {barData ? <Bar data={barData} options={{ plugins: { legend: { display: false } },scales: { x: { grid: { display: false } }, y: { grid: { color: "rgba(0,0,0,0.05)" } } }}}/> : <p className="text-sm text-zinc-500">No issues/PRs yet.</p>}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
