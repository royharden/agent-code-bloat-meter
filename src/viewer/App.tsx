import { useEffect, useState } from 'react';
import type { DemoData, ResultsData } from './data';
import { loadData, parseDemo, parseResults } from './data';

const percent = (value: number | null | undefined) => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
const count = (value: number | null | undefined) => value == null ? '—' : String(value);
const interval = (value: [number, number] | 'undefined' | null | undefined) =>
  value == null ? '' : value === 'undefined' ? ' [undefined]' : ` [${percent(value[0])}, ${percent(value[1])}]`;

export function App() {
  const [demo, setDemo] = useState<DemoData | null>(null);
  const [results, setResults] = useState<ResultsData | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState<'analysis' | 'results'>('analysis');
  const [ordering, setOrdering] = useState<'tier-policy' | 'size-asc'>('tier-policy');
  const [budget, setBudget] = useState(20);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setError(''); setDemo(null); setResults(null);
    Promise.all([loadData('demo-analysis').then(parseDemo), loadData('results').then(parseResults)])
      .then(([d, r]) => { if (active) { setDemo(d); setResults(r); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load data'); });
    return () => { active = false; };
  }, [retry]);
  const analysis = demo?.analysis;
  const hunks = analysis && demo?.orderings ? demo.orderings[ordering].map(id => analysis.hunks.find(h => h.id === id)!) : [];
  const total = hunks.reduce((n, h) => n + h.atoms.length, 0);
  const limit = Math.floor(total * budget / 100);
  let consumed = 0;
  return <div className="shell">
    <header><a className="brand" href="#main"><span className="brand-mark">↳</span> Diff Review Tiers</a><span className="eyebrow">ENGINEERING PREVIEW · S45</span></header>
    <main id="main">
      <div className="hero"><p className="eyebrow">A fixed budget. A different reading order.</p><h1>Put the next<br /><em>review line</em> in context.</h1>
        <p className="intro">Explore how structural tiers allocate attention across a TypeScript diff. Defect exposure measures allocation; it does not measure reviewer discovery.</p>
        <span className="status">● {results?.state === 'measured' ? 'Measured results loaded' : 'Study not yet measured'}</span></div>
      <nav aria-label="Views"><button className={page === 'analysis' ? 'active' : ''} onClick={() => setPage('analysis')}>01 / Analysis demo</button>
        <button className={page === 'results' ? 'active' : ''} onClick={() => setPage('results')}>02 / Study results</button></nav>
      {error ? <section className="notice" role="alert"><h2>Data could not be loaded</h2><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>Try again</button></section> :
        !demo || !results ? <p className="notice" role="status">Loading local data…</p> : page === 'analysis' ? <>
          <div className="section-heading"><div><p className="eyebrow">BUILDER-AUTHORED ENGINEERING FIXTURE</p><h2>Reading order, made visible.</h2></div><p>No study data or hidden witnesses.</p></div>
          {demo.state === 'not-generated' ? <section className="notice"><h3>Demo analysis has not been generated.</h3><p>The source is constructed. Analysis metrics and tiers have not been executed or verified.</p>
            <p>After Normal mode is authorized and dependencies are installed, run <code>npm run demo -- --write</code>, then reload this page.</p></section> : analysis && hunks.length ? <>
            <div className="controls"><label>Ordering<select value={ordering} onChange={e => { setOrdering(e.target.value as typeof ordering); setExpanded(null); }}><option value="tier-policy">Tier policy</option><option value="size-asc">Size · smallest first</option></select></label>
              <fieldset><legend>Changed-line budget</legend>{[10, 20, 30].map(n => <button key={n} aria-pressed={budget === n} onClick={() => setBudget(n)}>{n}%</button>)}</fieldset>
              <p><strong>{limit} / {total}</strong> changed-line atoms<br /><small>floor(budget × total); context is free</small></p></div>
            <p className="quiet">{analysis.changeId} · {analysis.status} · candidate thresholds T={demo.thresholds?.T ?? '—'}, N={demo.thresholds?.N ?? '—'} · engineering demo, not a frozen study policy</p>
            <div className="legend"><span>Tier 2 / manual first</span><span>Tier 1 next</span><span>Tier 0 last</span><span className="included">Filled = budgeted prefix</span></div>
            <div className="hunk-list">{hunks.map((h, i) => {
              const selected = Math.max(0, Math.min(h.atoms.length, limit - consumed)); consumed += h.atoms.length;
              const cut = selected > 0 && selected < h.atoms.length;
              const tier = demo.tiers![h.id]; const m = analysis.metrics.find(v => v.hunkId === h.id);
              return <article className={`hunk tier-${tier}`} key={h.id}><button className="hunk-toggle" aria-expanded={expanded === h.id} onClick={() => setExpanded(expanded === h.id ? null : h.id)}>
                <span className="sequence">{String(i + 1).padStart(2, '0')}</span><span className="hunk-title"><strong>{h.path}</strong><small>base {h.baseStart} +{h.baseCount} → head {h.headStart} +{h.headCount}</small></span>
                <span className="tier-tag">{tier === 'manual' ? 'Analysis incomplete' : `Tier ${tier}`}</span><span>{selected}/{h.atoms.length} atoms</span><span aria-hidden="true">{expanded === h.id ? '−' : '+'}</span></button>
                <div className="atom-bar" aria-label={`${selected} of ${h.atoms.length} atoms selected`}><span style={{ width: `${selected / h.atoms.length * 100}%` }} /></div>
                {cut && <p className="cutline">Budget cut line · partial hunk: only its first {selected} changed atoms are included</p>}
                {expanded === h.id && <div className="hunk-detail"><dl><dt>Positive complexity delta</dt><dd>{m?.maxPositiveDelta.value ?? 'unknown'}</dd><dt>Catch may swallow</dt><dd>{String(m?.catchMaySwallow.value ?? 'unknown')}</dd><dt>Statements without a changed-test reference</dt><dd>{m?.untestedChangedStatementMax.value ?? 'unknown'}</dd></dl>
                  <p>{m?.manual ? `Analysis incomplete: ${m.manualReasons.join(', ')}` : 'Syntactic diagnostics; no correctness judgment.'}</p><div className="atoms">{h.atoms.map((a, index) => <span key={`${a.side}:${a.line}`} className={index < selected ? 'included' : ''}>{a.side === 'base' ? '−' : '+'}{a.line}</span>)}</div></div>}
              </article>;
            })}</div>
          </> : <section className="notice"><h3>No changed hunks to display.</h3><p>Empty, unsupported, or unchanged inputs do not constitute successful zero findings.</p></section>}
        </> : <Results results={results} />}
      <footer><strong>Diff Review Tiers</strong><span>Exposure ≠ discovery. Mock reviewer output is not measurement.</span><span>Static local data · no live reviewer adapter</span></footer>
    </main>
  </div>;
}

function Results({ results: r }: { results: ResultsData }) {
  return <section><div className="section-heading"><div><p className="eyebrow">ARM A · ALLOCATION STUDY</p><h2>{r.state === 'measured' ? 'Study results' : 'Not yet measured.'}</h2></div><p>Blank cells mean unavailable, never zero.</p></div>
    {r.state !== 'measured' ? <p className="notice">No held-out attempt has produced a result. Gate 1, dev tuning, protocol freeze, and independent execution remain pending. Engineering demos and mocks cannot fill this table.</p> :
      <div className="notice"><p>Primary conclusion: <strong>{r.header.verdict ?? 'undefined'}</strong> · precision: {r.header.precision ?? 'unavailable'} · comparator: {r.header.primarySizeComparator ?? 'unavailable'}</p><details><summary>Attempt and provenance</summary><dl>{Object.entries(r.header).map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="hash">{v ?? '—'}</dd></div>)}</dl></details></div>}
    <div className="table-wrap"><table><caption>Defect exposure recall · changed-line atom budgets</caption><thead><tr>{['Ordering / status', 'Roots / defects', 'Recall @10', 'Recall @20 [95% CI]', 'Recall @30', 'Δ@20 vs size [95% CI]', 'Tier 2 all / clean', 'Near-misses flagged', 'Manual hunks', 'Partial hunks', 'Requests / USD'].map(c => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{r.rows.map(row => <tr key={row.ordering}><th scope="row">{row.ordering}<small>{row.status}{row.statusNote ? ` · ${row.statusNote}` : ''}</small></th><td>{count(row.roots)} / {count(row.defects)}</td><td>{percent(row.recall10)}</td><td>{percent(row.recall20)}{interval(row.recall20CI)}</td><td>{percent(row.recall30)}</td><td>{percent(row.delta20)}{interval(row.delta20CI)}</td><td>{percent(row.tier2ShareAll)} / {percent(row.tier2ShareClean)}</td><td>{count(row.nearMissesFlagged)}</td><td>{count(row.manualHunks)}</td><td>{count(row.partialHunks)}</td><td>{count(row.providerRequests)} / {row.spentUsd == null ? '—' : `$${row.spentUsd.toFixed(2)}`}</td></tr>)}</tbody></table></div>
    {r.perFamily.length > 0 && <details><summary>Per-family recall @20</summary><ul>{r.perFamily.map(row => <li key={`${row.ordering}:${row.family}`}>{row.ordering} · {row.family}: {percent(row.recall20)}{interval(row.recall20CI)} · {count(row.defects)} defects</li>)}</ul></details>}
    {r.wholeHunk.length > 0 && <details><summary>Whole-hunk sensitivity</summary><ul>{r.wholeHunk.map(row => <li key={row.ordering}>{row.ordering}: @10 {percent(row.recall10)}, @20 {percent(row.recall20)}, @30 {percent(row.recall30)}</li>)}</ul></details>}
    <div className="result-notes"><section><h3>Arm B · localization</h3>{r.armB === 'arm B not run' ? <p>Arm B not run. The keyless mock tests plumbing only.</p> : <><p>{r.armB.status}</p><ul>{r.armB.rows.map(row => <li key={row.ordering}>{row.ordering} · {row.status}: {count(row.localizationHits)} localization hits, {count(row.duplicates)} duplicates, {count(row.unmatched)} unmatched; {count(row.providerRequests)} requests, USD {count(row.spentUsd)}</li>)}</ul></>}</section>
      <section><h3>Named failure checklist</h3><ul className="failures">{r.namedFailures.map(f => <li key={f.id}><span>{f.id}</span><strong>{count(f.count)}</strong></li>)}</ul></section></div>
  </section>;
}
