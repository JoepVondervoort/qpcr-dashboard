const SEPARATOR=/[_\-\s]/
const MIN_PREFIX=4

/** Longest common prefix ending at a separator, so a shared label like "LAD081_HDFn_" can be shown once. */
export function sharedPrefix(names:string[]):string {
 const unique=[...new Set(names)]
 if(unique.length<2)return ''
 let prefix=unique.reduce((common,name)=>{let i=0;while(i<common.length&&common[i]===name[i])i++;return common.slice(0,i)})
 while(prefix&&!SEPARATOR.test(prefix.at(-1)!))prefix=prefix.slice(0,-1)
 return prefix.length>=MIN_PREFIX&&unique.every(name=>name.length>prefix.length)?prefix:''
}

export function withoutPrefix(name:string,prefix:string):string {return prefix&&name.startsWith(prefix)?name.slice(prefix.length):name}
