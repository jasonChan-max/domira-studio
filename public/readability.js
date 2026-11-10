const storageKey='domira.readability.v1';
let settings={large:false,contrast:false};
try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved)settings={large:saved.large===true,contrast:saved.contrast===true};}catch{}

export function syncReadability(root=document){
 for(const [key,enabled] of Object.entries(settings)){
  document.documentElement.classList.toggle('reading-'+key,enabled);
  root.querySelectorAll(`[data-reading="${key}"]`).forEach(button=>button.setAttribute('aria-pressed',String(enabled)));
 }
}

document.addEventListener('click',event=>{
 const button=event.target.closest('[data-reading]');
 if(!button||!Object.hasOwn(settings,button.dataset.reading))return;
 const key=button.dataset.reading;
 settings[key]=!settings[key];
 try{localStorage.setItem(storageKey,JSON.stringify(settings));}catch{}
 syncReadability();
});
syncReadability();
