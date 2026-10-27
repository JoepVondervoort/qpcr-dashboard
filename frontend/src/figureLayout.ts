export type TimeSpacing = 'auto' | 'measured' | 'proportional'

const MIN_GAP_SHARE = 0.12

/** Elapsed time is drawn to scale unless the closest time points would overlap; bars always use equal slots. */
export function resolveTimeSpacing(times: number[], bars: boolean, requested: TimeSpacing): Exclude<TimeSpacing,'auto'> {
  if (requested !== 'auto') return requested
  if (bars) return 'measured'
  const sorted = [...new Set(times)].sort((a,b)=>a-b)
  if (sorted.length < 3) return 'proportional'
  const gaps = sorted.slice(1).map((time,i)=>time-sorted[i])
  return Math.min(...gaps)/(sorted[sorted.length-1]-sorted[0]) < MIN_GAP_SHARE ? 'measured' : 'proportional'
}

const BAR_GAP = 4, MAX_BAR = 30, MIN_BAR = 3, MAX_LINE_DODGE = 14

/** Horizontal offsets per series within one time slot: bars sit side by side, line markers only just apart. */
export function seriesDodge(count: number, slot: number, bars: boolean): {offsets: number[]; barWidth: number} {
  const n = Math.max(1, count), width = Math.max(MIN_BAR, Math.min(MAX_BAR, slot*.7/n - BAR_GAP))
  // In a narrow slot the gap shrinks first, then the bars, so a time point never spills into its neighbour.
  const step = bars ? Math.min(width + BAR_GAP, slot*.9/n) : Math.min(MAX_LINE_DODGE, slot*.4/n)
  const barWidth = bars ? Math.min(width, step*.85) : width
  return {offsets: Array.from({length: count}, (_, i) => (i - (count-1)/2) * step), barWidth}
}

/** Vertical positions for end-of-line labels: overlapping labels form clusters centred on their data. */
export function spreadLabels(positions: number[], gap: number, top: number, bottom: number): number[] {
  const order = positions.map((_, i) => i).sort((a, b) => positions[a]-positions[b] || a-b)
  let clusters = order.map(i => ({members: [i], start: positions[i]}))
  const place = (members: number[]) => {
    const centre = members.reduce((sum, i) => sum+positions[i], 0)/members.length, span = (members.length-1)*gap
    return Math.max(top, Math.min(bottom-span, centre-span/2))
  }
  for (let merged = true; merged;) {
    merged = false
    clusters = clusters.reduce<typeof clusters>((done, cluster) => {
      const last = done[done.length-1]
      if (last && last.start+last.members.length*gap > cluster.start) {
        merged = true
        const members = [...last.members, ...cluster.members]
        return [...done.slice(0, -1), {members, start: place(members)}]
      }
      return [...done, {...cluster, start: cluster.members.length > 1 ? place(cluster.members) : Math.max(top, Math.min(bottom, cluster.start))}]
    }, [])
  }
  const result = [...positions]
  for (const cluster of clusters) cluster.members.forEach((index, k) => { result[index] = cluster.start+k*gap })
  return result
}

/** Set PNG physical resolution without resampling its pixels. */
export function pngWithDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const ppm=Math.round(dpi/0.0254)
  const chunk=new Uint8Array(21), view=new DataView(chunk.buffer)
  view.setUint32(0,9);chunk.set([112,72,89,115],4)
  view.setUint32(8,ppm);view.setUint32(12,ppm);chunk[16]=1
  let crc=0xffffffff
  for(const byte of chunk.subarray(4,17)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
  view.setUint32(17,(crc^0xffffffff)>>>0)
  const parts:Uint8Array[]=[bytes.subarray(0,33),chunk]
  for(let offset=33;offset<bytes.length;){
    const length=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0)+12
    if(String.fromCharCode(...bytes.subarray(offset+4,offset+8))!=='pHYs')parts.push(bytes.subarray(offset,offset+length))
    offset+=length
  }
  const output=new Uint8Array(parts.reduce((size,part)=>size+part.length,0));let offset=0
  for(const part of parts){output.set(part,offset);offset+=part.length}
  return output
}

/** Left-to-right legend placement: an item that does not fit starts a new row. */
export function flowLegend(widths: number[], available: number, gap: number): {items: {x: number; row: number}[]; rows: number} {
  const items = widths.reduce<{x: number; row: number; end: number}[]>((placed, width) => {
    const last = placed[placed.length-1]
    const x = last ? last.end+gap : 0
    return [...placed, last && x+width > available ? {x: 0, row: last.row+1, end: width} : {x, row: last?.row ?? 0, end: x+width}]
  }, [])
  return {items: items.map(({x, row}) => ({x, row})), rows: items.length ? items[items.length-1].row+1 : 0}
}
