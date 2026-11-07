/** Save text the browser holds as a file, without a server round trip. */
export function saveFile(content:string,type:string,name:string) {
 const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a')
 link.href=url;link.download=name;link.click()
 setTimeout(()=>URL.revokeObjectURL(url),1000)
}

/** Standalone SVG markup of a rendered figure, for a .svg file. */
export function svgMarkup(svg:SVGSVGElement):string {
 const copy=svg.cloneNode(true) as SVGSVGElement
 copy.setAttribute('xmlns','http://www.w3.org/2000/svg')
 return new XMLSerializer().serializeToString(copy)
}

/** A file name from free text: letters, digits, dots, dashes and underscores only. */
export const fileStem=(text:string)=>text.trim().replace(/[^\w.-]+/g,'_').replace(/^_+|_+$/g,'')||'figure'
