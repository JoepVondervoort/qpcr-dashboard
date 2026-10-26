import { type ReactNode, useRef } from 'react'
import { mean, sampleSD, type Observation } from './plotData'
const palette = ['#167b80','#b56445','#5065a2','#946eab','#7c833a','#be748c','#426b7a','#ab8a38']
const compact = (v: number) => Number(v.toPrecision(3)).toString()
function wrap(text: string, length: number): string[] {
  const words = text.split(/\s+/).flatMap(word=>word.length<=length?[word]:Array.from({length:Math.ceil(word.length/length)},(_,i)=>word.slice(i*length,(i+1)*length))), lines: string[] = []
  let line = ''
  for (const word of words) { if (line && (line+' '+word).length>length) {lines.push(line); line=word} else line = line ? line+' '+word : word }
  if (line) lines.push(line)
  return lines
}
function stableJitter(text: string) { let hash=0; for (const c of text) hash=(hash*31+c.charCodeAt(0))|0; return ((hash>>>0)%101/100-.5) }

export function PublicationFigure({title, subtitle, observations, kind, bars=false, threshold, technical=false, missing=0, omitted=0,emptyMessage,footer,timeAxisLabel='Time after transfection',colorDomain=[],preset='double',fixedDomain,reviewNote='',methods={}}: {
  title: string; subtitle: string; observations: Observation[]; kind: 'ct'|'expression'; bars?: boolean; threshold?: number; technical?: boolean; missing?: number; omitted?: number; emptyMessage?: string; footer?: ReactNode; timeAxisLabel?: string; colorDomain?: string[]; preset?: 'single'|'double'; fixedDomain?: [number,number]; reviewNote?: string; methods?:Record<string,unknown>
}) {
  const svg = useRef<SVGSVGElement>(null)
  const categories = [...new Map(observations.map(o => [o.category,{key:o.category,label:o.categoryLabel,time:o.time,unit:o.unit}])).values()]
    .sort((a,b) => a.time != null && b.time != null ? a.unit.localeCompare(b.unit) || a.time-b.time : a.label.localeCompare(b.label,undefined,{numeric:true}))
  const series = [...new Map(observations.map(o => [o.series,{key:o.series,label:o.seriesLabel}])).values()].sort((a,b)=>a.label.localeCompare(b.label,undefined,{numeric:true}))
  const color=(index:number)=>{const domainIndex=colorDomain.indexOf(series[index].label);return palette[(domainIndex<0?index:domainIndex)%palette.length]}
  const summaries = series.flatMap(s => categories.map(category => {
    const members = observations.filter(o => o.series===s.key && o.category===category.key)
    const biologicalMeans = members.map(m => mean(m.values)).filter((v):v is number => v!=null)
    return {series:s.key,category:category.key,members,mean:mean(biologicalMeans),sd:sampleSD(biologicalMeans),n:biologicalMeans.length}
  }))
  const finite = observations.flatMap(o => [...o.values,...(o.omitted ?? [])]).filter(Number.isFinite)
  const temporal = categories.length>1 && categories.every(c=>c.time!=null) && new Set(categories.map(c=>c.unit)).size===1
  const width = preset==='single'?360:720
  const paperWidth=preset==='single'?85:180
  const subtitleLines=wrap(subtitle,Math.floor((width-90)/6.5))
  const left=preset==='single'?62:78, right=width-24, top=78+subtitleLines.length*16, bottom=top+230
  const extrema = [...finite,...summaries.flatMap(s=>s.mean==null?[]:[s.mean+(s.sd??0),s.mean-(s.sd??0)])]
  const rawLow = fixedDomain?fixedDomain[0]:kind==='expression' ? 0 : Math.max(0,Math.min(...extrema,40)-.6)
  const rawHigh = fixedDomain?fixedDomain[1]:kind==='expression' ? Math.max(2,(threshold??0)*1.06,...extrema.map(v=>v*1.08)) : Math.max(rawLow+2,Math.max(...extrema,0)+.6)
  const rough=(rawHigh-rawLow)/4, power=10**Math.floor(Math.log10(rough)), fraction=rough/power
  const step=(fraction<=1?1:fraction<=2?2:fraction<=2.5?2.5:fraction<=5?5:10)*power
  const low=Math.floor(rawLow/step)*step, high=Math.ceil(rawHigh/step)*step
  const ticks=Array.from({length:Math.round((high-low)/step)+1},(_,i)=>low+i*step)
  const y = (value:number) => bottom-(value-low)/(high-low)*(bottom-top)
  const categoricalStep=(right-left)/Math.max(1,categories.length)
  const minTime=Math.min(...categories.map(c=>c.time??0)), maxTime=Math.max(...categories.map(c=>c.time??0))
  const x = (key:string) => {
    const index=categories.findIndex(c=>c.key===key), category=categories[index]
    return temporal ? left+42+(category.time!-minTime)/(maxTime-minTime)*(right-left-84) : left+categoricalStep*(index+.5)
  }
  const spacing = temporal ? (right-left-84)/Math.max(1,categories.length-1) : categoricalStep
  const offset = (seriesIndex:number) => series.length===1?0:(seriesIndex-(series.length-1)/2)*Math.min(24,spacing*.6/series.length)
  const denseTime=temporal&&categories.slice(1).some((c,i)=>x(c.key)-x(categories[i].key)<Math.max(c.label.length,categories[i].label.length)*6.5+8)
  const axisTicks=denseTime?Array.from({length:5},(_,i)=>({position:left+42+i/4*(right-left-84),label:compact(minTime+(maxTime-minTime)*i/4)})):categories.map(c=>({position:x(c.key),label:c.label}))
  const labelLines = categories.map(c=>wrap(c.label,Math.max(6,Math.floor(categoricalStep/7))))
  const maxLabelLines=Math.max(1,...labelLines.map(l=>l.length))
  const labelBottom=bottom+24+(denseTime?16:maxLabelLines*16)+(technical||denseTime?0:series.length*14)
  const legendStart=labelBottom+36
  const legends=series.map(s=>wrap(s.label+(denseTime&&!technical?` · biological n [${categories.map(c=>c.label).join('/')}] = ${categories.map(c=>summaries.find(v=>v.series===s.key&&v.category===c.key)?.n??0).join('/')}`:''),Math.floor((width-left-40)/6.5)))
  const legendRows=series.reduce((n,_,i)=>n+Math.max(1,legends[i].length),0)
  const footerNotes=[technical?'Technical controls: QC only; excluded from expression and statistics.':kind==='ct'?'Small dots: technical wells. Open circles: biological Ct means. Whiskers: sample SD. n: biological samples.':(bars?'Open circles: biological samples. Mean ± sample SD. Bars originate at 1×.':'Open circles: biological samples. Lines: condition means ± sample SD.'),
    temporal?'Lines connect condition means; pairing is not inferred.':'Pairing is not inferred.',
    kind==='ct'?`Missing / undetermined: ${missing}; omitted / excluded: ${omitted}.`:'',reviewNote].filter(Boolean)
  const footerLines=footerNotes.flatMap(note=>wrap(note,Math.floor((width-left-20)/6.2)))
  const footerStart=legendStart+legendRows*20+24
  const height=footerStart+footerLines.length*16+16
  const exportName=`${title.replace(/[^a-z0-9]+/gi,'-')}-${kind}`
  const dataRows=observations.flatMap(o=>o.data??o.values.map(value=>({sample:o.sample,run:o.run,condition:o.categoryLabel,value,source:o.source})))
  function fileDownload(content:string,type:string,name:string){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function downloadData(){const headers=[...new Set(dataRows.flatMap(row=>Object.keys(row)))];const cell=(value:unknown)=>{const text=value==null?'':typeof value==='object'?JSON.stringify(value):String(value);return '"'+text.replace(/"/g,'""')+'"'};fileDownload([headers.map(cell).join(','),...dataRows.map(row=>headers.map(h=>cell(row[h])).join(','))].join('\r\n'),'text/csv;charset=utf-8',exportName+'-data.csv')}
  function downloadMethods(){fileDownload(JSON.stringify({title,kind,subtitle,figure:{width_mm:paperWidth,min_font_pt:8,view:bars?'bars from 1x':'condition means',axis_title:timeAxisLabel},review_status:reviewNote,missing,omitted,methods},null,2),'application/json',exportName+'-methods.json')}

  function download() {
    if (!svg.current) return
    const copy = svg.current.cloneNode(true) as SVGSVGElement
    copy.setAttribute('xmlns','http://www.w3.org/2000/svg')
    copy.setAttribute('width',`${paperWidth}mm`)
    copy.setAttribute('height',`${height/width*paperWidth}mm`)
    const metadata=document.createElementNS('http://www.w3.org/2000/svg','metadata');metadata.textContent=JSON.stringify({methods,review_status:reviewNote,min_font_pt:8});copy.prepend(metadata)
    fileDownload(new XMLSerializer().serializeToString(copy),'image/svg+xml;charset=utf-8',exportName+'.svg')
  }
  const legendOffsets=legends.map((_,i)=>legends.slice(0,i).reduce((total,lines)=>total+Math.max(1,lines.length),0))
  return <article className="figure-card" data-size={preset}>
    <div className="figure-heading"><h4 className={finite.length?'sr-only':''}>{title}</h4><div className="figure-downloads"><button className="quiet-button figure-export" disabled={!finite.length} onClick={download} aria-label={`Download ${title} ${kind} SVG`}>SVG</button><button className="quiet-button figure-export" disabled={!dataRows.length} onClick={downloadData} aria-label={`Download ${title} ${kind} plotted data`}>Data CSV</button><button className="quiet-button figure-export" onClick={downloadMethods} aria-label={`Download ${title} ${kind} methods`}>Methods JSON</button></div></div>
    {!finite.length ? <p className="figure-empty">{emptyMessage ?? `No numeric ${kind==='ct'?'Ct values':'normalized results'} in this selection. Missing / undetermined: ${missing}.`}</p> : <div className="figure-scroll"><svg ref={svg} role="img" aria-label={`${title} · ${kind==='ct'?'raw Ct values':'normalized expression'}`} viewBox={`0 0 ${width} ${height}`} width={`${paperWidth}mm`} height={`${height/width*paperWidth}mm`} style={{fontFamily:'Arial, Helvetica, sans-serif',background:'#fff',color:'#23343b'}}>
      <title>{title} — {subtitle}</title><desc>{observations.map(o=>`${o.sample}; ${o.source}; values: ${o.values.join(', ')}`).join('\n')}. Lines connect condition means, not paired samples.</desc>
      <rect width={width} height={height} fill="white"/>
      <text x={left} y="34" fontSize="20" fontWeight="600" fill="#172b33">{title}</text>
      <text x={left} y="57" fontSize="12" fill="#607078">{subtitleLines.map((line,i)=><tspan key={i} x={left} dy={i?16:0}>{line}</tspan>)}</text>
      {ticks.map((value,i)=><g key={i}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#e8edef" strokeWidth="1"/><text x={left-12} y={y(value)+4} textAnchor="end" fontSize="12" fill="#53656c">{compact(value)}</text></g>)}
      <line x1={left} x2={left} y1={top} y2={bottom} stroke="#596b72" strokeWidth="1"/>
      <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#596b72" strokeWidth="1"/>
      <text transform={`translate(22 ${(top+bottom)/2}) rotate(-90)`} textAnchor="middle" fontSize="13" fill="#273f48">{kind==='ct'?'Ct (cycles)':'Relative expression (fold change)'}</text>
      {kind==='expression' && <><line data-baseline="1" x1={left} x2={right} y1={y(1)} y2={y(1)} stroke="#687c83" strokeDasharray="5 4"/><text x={right} y={y(1)-7} textAnchor="end" fontSize="12" fill="#566d75">1× baseline</text>
        {threshold!=null && threshold!==1 && <><line x1={left} x2={right} y1={y(threshold)} y2={y(threshold)} stroke="#bc9367" strokeDasharray="3 5"/><text x={right} y={y(threshold)-6} textAnchor="end" fontSize="12" fill="#946e43">{threshold}× effect threshold</text></>}</>}
      {series.map((s,si)=>{
        const seriesColor=color(si), summary=summaries.filter(v=>v.series===s.key)
        // Draw only adjacent measured time points: missing time points leave a gap.
        const segments = temporal && !bars ? summary.slice(1).flatMap((v,i)=>v.mean!=null && summary[i].mean!=null ? [<line data-line-meaning="condition-means" key={v.category} x1={x(summary[i].category)+offset(si)} y1={y(summary[i].mean!)} x2={x(v.category)+offset(si)} y2={y(v.mean)} stroke={seriesColor} strokeWidth="1.8" opacity=".8"/>] : []) : []
        return <g key={s.key}>{!technical && segments}{summary.map(v=>{
          const center=x(v.category)+offset(si)
          return <g key={v.category}>
            {kind==='expression' && bars && v.mean!=null && <rect data-mean={v.mean} data-baseline-y={y(1)} x={center-Math.min(17,spacing/series.length*.24)} y={Math.min(y(1),y(v.mean))} width={Math.min(34,spacing/series.length*.48)} height={Math.abs(y(1)-y(v.mean))} fill={seriesColor} fillOpacity=".2" stroke={seriesColor} strokeWidth="1"/>}
            {v.members.map(member=> <g key={member.sample}>
              {kind==='ct' && member.values.map((value,i)=><circle key={i} cx={center+stableJitter(member.sample+':'+i)*24} cy={y(value)} r="2.8" fill={seriesColor} fillOpacity=".28"><title>{member.sample} · {member.categoryLabel} · Ct {value.toFixed(3)} · {member.source} · technical measurement {i+1}</title></circle>)}
              {(member.omitted??[]).map((value,i)=>{const cx=center+stableJitter(member.sample+':omit'+i)*24; return <path key={`o${i}`} d={`M${cx-3},${y(value)-3}l6,6m0,-6l-6,6`} stroke="#b65a57" strokeWidth="1.3"><title>{member.sample} · {member.categoryLabel} · {member.omittedDetails?.[i]?.well??''} · Ct {value} · {member.omittedDetails?.[i]?.reason??'Omitted / excluded'} (not used in mean)</title></path>})}
              {!technical && mean(member.values)!=null && <circle cx={center+stableJitter(member.sample)*20} cy={y(mean(member.values)!)} r={kind==='ct'?4:4.2} fill="white" stroke={seriesColor} strokeWidth="1.8"><title>{member.sample} · {member.categoryLabel} · {kind==='ct'?'biological sample Ct mean':'fold change'} {mean(member.values)!.toFixed(3)} · {member.source}</title></circle>}
            </g>)}
            {!technical && v.mean!=null && <>
              {v.sd!=null && <g stroke={seriesColor} strokeWidth="1.4"><line x1={center} x2={center} y1={y(v.mean+v.sd)} y2={y(Math.max(0,v.mean-v.sd))}/><line x1={center-5} x2={center+5} y1={y(v.mean+v.sd)} y2={y(v.mean+v.sd)}/><line x1={center-5} x2={center+5} y1={y(Math.max(0,v.mean-v.sd))} y2={y(Math.max(0,v.mean-v.sd))}/></g>}
              <line x1={center-7} x2={center+7} y1={y(v.mean)} y2={y(v.mean)} stroke={seriesColor} strokeWidth="2.8"/>
            </>}
          </g>
        })}</g>
      })}
      {axisTicks.map((tick,i)=><g key={i}><line x1={tick.position} x2={tick.position} y1={bottom} y2={bottom+5} stroke="#596b72"/><text x={tick.position} y={bottom+22} textAnchor="middle" fontSize="12" fill="#344e58">{(denseTime?[tick.label]:labelLines[i]).map((line,j)=><tspan key={j} x={tick.position} dy={j?16:0}>{line}</tspan>)}</text>{!technical&&!denseTime&&series.map((s,si)=><text key={s.key} x={tick.position} y={bottom+24+maxLabelLines*16+si*14} textAnchor="middle" fontSize="12" fill={color(si)}>n = {summaries.find(v=>v.category===categories[i].key&&v.series===s.key)?.n??0}</text>)}</g>)}
      <text x={(left+right)/2} y={labelBottom+12} textAnchor="middle" fontSize="13" fill="#344e58">{temporal?`${timeAxisLabel} (${categories[0]?.unit==='hour'?'hours':'days'})`:'Condition / time point'}</text>
      {series.map((s,i)=>{ const row=legendOffsets[i]; return <g key={s.key} transform={`translate(${left},${legendStart+row*19})`}><line x1="0" x2="20" y1="0" y2="0" stroke={color(i)} strokeWidth="2"/><text x="28" y="4" fontSize="12" fill="#3a525c">{legends[i].map((line,j)=><tspan key={j} x="28" dy={j?19:0}>{line}</tspan>)}</text></g>})}
      {footerLines.map((line,i)=><text key={i} x={left} y={footerStart+i*16} fontSize="12" fill={reviewNote&&line.includes('STALE')?'#9e4e35':'#5b7078'}>{line}</text>)}
    </svg></div>}
    <p className="figure-caption screen-only">{technical?'Technical controls shown for QC only.':kind==='ct'?'Every eligible technical Ct is shown. Larger open circles summarize each biological sample; the group mean and sample SD weight biological samples equally.':'Biological replicate points with mean ± sample SD. Fold changes remain relative to each analysis’s saved baseline.'} {kind==='ct'&&`${missing} missing/undetermined; ${omitted} instrument-omitted or researcher-excluded measurements.`} {kind==='expression'&&'SD below zero is clipped at zero.'}</p>{footer}
  </article>
}
