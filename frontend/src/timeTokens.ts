// Mirrors backend/qpcr_engine/sample_metadata.py so suggestions and group labels agree.
const NUMBER='(-?\\d+(?:\\.\\d+)?)'
// A word unit, then a number: "day 0", "Day21", "_day0", "dpt3". A letter or digit right before the unit makes it part of another word.
const WORD_FIRST=new RegExp(`(?<![a-z0-9])(days?|dpt|hours?|hrs?)\\s*${NUMBER}(?![a-z0-9])`,'i')
// "72h", "48 hpt", "7 days"; a bare "d" is left out because "3D" is usually a culture format.
const NUMBER_FIRST=/(?<![a-z0-9.])(\d+(?:\.\d+)?)\s*(hours?|hrs?|hpt|h|days?|dpt)(?![a-z0-9])/i
// "d7" is read as day 7; a single "h" before a number never means hours (H1, H9 and NCI-H1299 are cell lines).
const LETTER_FIRST=new RegExp(`(?<![a-z0-9])(d)\\s*${NUMBER}(?![a-z0-9])`,'i')
const REPLICATE=/\.(\d+)$/
const REPLICATE_THEN_LABEL=/^(.*?(?<![a-z0-9])(?:days?|dpt|d|hours?|hrs?)\s*\d+)\.(\d+)\s+([^\s.][^.]*)$/i
const PATTERNS=[[WORD_FIRST,false],[NUMBER_FIRST,true],[LETTER_FIRST,false]] as const

export type TimeToken={value:number;unit:'day'|'hour';start:number;end:number}

export function findTime(text:string):TimeToken|null {
 for(const [pattern,numberFirst] of PATTERNS){
  const match=text.match(pattern)
  if(match?.index==null)continue
  const [value,unit]=numberFirst?[match[1],match[2]]:[match[2],match[1]]
  return {value:Number(value),unit:/^h/i.test(unit)?'hour':'day',start:match.index,end:match.index+match[0].length}
 }
 return null
}

/** Remove the time token and join what remains with the separator that surrounded it. */
export function withoutTime(text:string,token:TimeToken):string {
 const left=text.slice(0,token.start),right=text.slice(token.end)
 const leftCore=left.replace(/[ _-]+$/,''),rightCore=right.replace(/^[ _-]+/,'')
 const gap=left.slice(leftCore.length)||right.slice(0,right.length-rightCore.length)
 const separator=gap.replace(/ /g,'').slice(0,1)||' '
 return leftCore&&rightCore?`${leftCore}${separator}${rightCore}`:leftCore||rightCore
}

/** The final ".N" is the biological replicate; in "day 21.2 RS" the label after it belongs to the condition. */
export function splitReplicate(name:string):{condition:string;replicate:string} {
 const text=name.trim(),replicate=text.match(REPLICATE)
 if(replicate?.index!=null)return {condition:text.slice(0,replicate.index).trim(),replicate:replicate[1]}
 const labelled=text.match(REPLICATE_THEN_LABEL)
 return labelled?{condition:`${labelled[1]} ${labelled[3].trim()}`,replicate:labelled[2]}:{condition:text,replicate:''}
}
