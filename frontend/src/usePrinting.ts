import {useEffect,useState} from 'react'
import {flushSync} from 'react-dom'

/** True while the page is printed (or print media is emulated), committed before the browser lays out the print. */
export function usePrinting():boolean {
 const [printing,setPrinting]=useState(()=>typeof window!=='undefined'&&Boolean(window.matchMedia?.('print').matches))
 useEffect(()=>{
  const media=window.matchMedia?.('print')
  const update=(value:boolean)=>flushSync(()=>setPrinting(value))
  const onMedia=(event:MediaQueryListEvent)=>update(event.matches),before=()=>update(true),after=()=>update(false)
  media?.addEventListener('change',onMedia);window.addEventListener('beforeprint',before);window.addEventListener('afterprint',after)
  return ()=>{media?.removeEventListener('change',onMedia);window.removeEventListener('beforeprint',before);window.removeEventListener('afterprint',after)}
 },[])
 return printing
}
