export type TimeSpacing = 'auto' | 'measured' | 'proportional'

export function resolveTimeSpacing(times: number[], bars: boolean, requested: TimeSpacing): Exclude<TimeSpacing,'auto'> {
  if (requested !== 'auto') return requested
  const sorted = [...new Set(times)].sort((a,b)=>a-b)
  const gaps = sorted.slice(1).map((time,i)=>time-sorted[i])
  return bars || (gaps.length>1 && Math.max(...gaps)/Math.min(...gaps)>=2.5) ? 'measured' : 'proportional'
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
