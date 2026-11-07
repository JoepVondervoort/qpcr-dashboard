import {useEffect,useRef,useState,type DragEvent as ReactDragEvent} from 'react'

const carriesFiles=(transfer:DataTransfer|null)=>[...(transfer?.types??[])].includes('Files')

/**
 * Files dropped anywhere in the window. Without this the browser opens a dropped file itself and leaves the app.
 * Drags that are not files (reordering gene panels) are left alone. While `accepting` says no (an import is
 * running, a dialog is open) the pointer shows that the drop is refused, rather than taking files and losing them.
 * Returns whether accepted files are being dragged over the window, outside any element with its own drop
 * target (useDropTarget).
 */
export function useWindowFileDrop(onFiles:(files:File[])=>void,accepting:()=>boolean=()=>true):boolean {
 const [over,setOver]=useState(false)
 const handler=useRef({onFiles,accepting})
 useEffect(()=>{handler.current={onFiles,accepting}},[onFiles,accepting])
 useEffect(()=>{
  // dragenter and dragleave fire for every element crossed; the depth counts how many the pointer is inside.
  let depth=0
  const enter=(event:DragEvent)=>{if(!carriesFiles(event.dataTransfer))return;depth+=1;setOver(handler.current.accepting())}
  const leave=(event:DragEvent)=>{
   if(!carriesFiles(event.dataTransfer))return
   // No related target: the pointer left the window (some browsers always report none, and dragover recovers).
   depth=event.relatedTarget?Math.max(0,depth-1):0
   if(!depth)setOver(false)
  }
  const move=(event:DragEvent)=>{
   if(!carriesFiles(event.dataTransfer))return
   // Cancelled even when refused: otherwise the browser opens the file itself and leaves the app.
   event.preventDefault()
   const accepted=handler.current.accepting()
   if(event.dataTransfer)event.dataTransfer.dropEffect=accepted?'copy':'none'
   depth=Math.max(depth,1);setOver(accepted)
  }
  const drop=(event:DragEvent)=>{
   if(!carriesFiles(event.dataTransfer))return
   event.preventDefault();depth=0;setOver(false)
   const files=[...(event.dataTransfer?.files??[])]
   if(files.length&&handler.current.accepting())handler.current.onFiles(files)
  }
  const listeners=[['dragenter',enter],['dragleave',leave],['dragover',move],['drop',drop]] as const
  for(const [type,listener] of listeners)window.addEventListener(type,listener)
  return ()=>{for(const [type,listener] of listeners)window.removeEventListener(type,listener)}
 },[])
 return over
}

/** An element that takes dropped files itself, so the window-wide drop does not. */
export function useDropTarget(onFiles:(files:File[])=>void,disabled=false) {
 const [active,setActive]=useState(false)
 const own=(event:ReactDragEvent)=>{
  if(!carriesFiles(event.dataTransfer))return false
  event.stopPropagation();event.preventDefault()
  return true
 }
 return {active,props:{
  onDragEnter:(event:ReactDragEvent)=>{if(own(event))setActive(!disabled)},
  onDragOver:(event:ReactDragEvent)=>{if(!own(event))return;event.dataTransfer.dropEffect=disabled?'none':'copy';setActive(!disabled)},
  onDragLeave:(event:ReactDragEvent)=>{if(own(event)&&!event.currentTarget.contains(event.relatedTarget as Node|null))setActive(false)},
  onDrop:(event:ReactDragEvent)=>{
   if(!own(event))return
   setActive(false)
   const files=[...event.dataTransfer.files]
   if(!disabled&&files.length)onFiles(files)
  },
 }}
}
