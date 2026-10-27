const labels:Record<string,string>={assessed:'Assessed',not_assessable:'Not assessable'}

export function normalityLabel(status:string):string {
 if(labels[status])return labels[status]
 const words=status.replaceAll('_',' ').trim()
 return words?words[0].toUpperCase()+words.slice(1):'Unknown'
}

const SMALL_N=/^(.+): fewer than three complete biological samples; (.+)$/

/** Merge the per-condition small-n caveat into one sentence; other warnings are kept as written. */
export function condenseWarnings(warnings:string[]):string[] {
 const small=warnings.map(warning=>warning.match(SMALL_N)).filter((match):match is RegExpMatchArray=>Boolean(match))
 if(small.length<2)return warnings
 const merged=`${small.length} conditions (${small.map(match=>match[1]).join(', ')}) have fewer than three complete biological samples; ${small[0][2]}`
 return [merged,...warnings.filter(warning=>!SMALL_N.test(warning))]
}
