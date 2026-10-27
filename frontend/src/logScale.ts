import {mean,sampleSD} from './plotData'

export type YScale='linear'|'log2'
export type FoldSummary={center:number;upper:number;lower:number;sd:number|null}

const MAX_LOG_TICKS=9

/**
 * Integer log2 ticks (powers of two). Steps widen so a wide range stays readable; a range
 * inside one doubling falls back to labelling its two ends.
 */
export function log2AxisTicks(low:number,high:number,requestedStep?:number|null):number[] {
 const span=Math.max(1,high-low)
 const step=requestedStep&&requestedStep>0?Math.max(1,Math.round(requestedStep)):Math.max(1,Math.ceil(span/(MAX_LOG_TICKS-1)))
 const first=Math.ceil((low-1e-9)/step)*step
 const ticks=Array.from({length:Math.max(0,Math.floor((high-first)/step+1e-9)+1)},(_,i)=>first+i*step)
 return ticks.length>=2?ticks:[...new Set([low,...ticks,high])].sort((a,b)=>a-b)
}

/** Number of ticks a log2 axis would draw for fold-change limits and a step in doublings. */
export function log2TickCount(min:number,max:number,step:number):number {return Math.log2(max/min)/Math.max(1,Math.round(step))}

const MIN_PAD=0.12,PAD_SHARE=0.06

/**
 * Log2 limits that hug positive fold changes: 1x is always inside, at least two powers of two
 * are labelled, and the data get a small margin instead of an empty doubling.
 */
export function log2Domain(values:number[],headroom=0):[number,number] {
 const logs=values.filter(value=>Number.isFinite(value)&&value>0).map(Math.log2)
 let low=Math.min(0,...logs),high=Math.max(0,...logs)
 // Only 1x is labelled: add the next doubling on the side the data lean towards (both when flat).
 if(high<1&&low>-1){if(high>-low)high=1;else if(-low>high)low=-1;else{low=-1;high=1}}
 const pad=Math.max(MIN_PAD,PAD_SHARE*(high-low))
 return [low-pad,high+pad+headroom]
}

const FRACTIONS:Record<number,string>={[-1]:'½',[-2]:'¼',[-3]:'⅛'}
/** Fold-change label for a log2 tick: 2×, ½×, 1/16×; ends of a narrow axis keep two significant figures. */
export function foldTickLabel(log2Value:number):string {
 const whole=Math.round(log2Value)
 if(Math.abs(log2Value-whole)>1e-9)return `${Number((2**log2Value).toPrecision(2))}×`
 return whole>=0?`${2**whole}×`:`${FRACTIONS[whole]??`1/${2**-whole}`}×`
}

/**
 * Centre and whiskers for biological fold changes. On a log2 axis this is the geometric
 * mean ×/÷ geometric SD (mean ± SD of log2 fold change); on a linear axis, mean ± SD clipped at 0.
 */
export function foldSummary(values:number[],scale:YScale):FoldSummary|null {
 const usable=scale==='log2'?values.filter(value=>value>0):values
 if(!usable.length)return null
 if(scale==='linear'){const center=mean(usable)!,sd=sampleSD(usable);return {center,sd,upper:center+(sd??0),lower:Math.max(0,center-(sd??0))}}
 const logs=usable.map(Math.log2),m=mean(logs)!,sd=sampleSD(logs)
 return {center:2**m,sd,upper:2**(m+(sd??0)),lower:2**(m-(sd??0))}
}
