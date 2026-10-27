import {useCallback,useRef,useState} from 'react'

const STEP=10

/** Width of an element in CSS pixels, rounded to 10 px so small layout shifts do not re-render charts. */
export function useElementWidth<T extends HTMLElement>():[(node:T|null)=>void,number|null] {
 const [width,setWidth]=useState<number|null>(null)
 const observer=useRef<ResizeObserver|null>(null)
 const ref=useCallback((node:T|null)=>{
  observer.current?.disconnect();observer.current=null
  if(!node||typeof ResizeObserver==='undefined')return
  const update=()=>{const next=Math.round(node.getBoundingClientRect().width/STEP)*STEP;if(next>0)setWidth(next)}
  update();observer.current=new ResizeObserver(update);observer.current.observe(node)
 },[])
 return [ref,width]
}
