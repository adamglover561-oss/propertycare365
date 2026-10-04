import { readFile,writeFile } from 'node:fs/promises';
let html=await readFile('../public/app/index.html','utf8');
html=html.replace('https://esm.sh/@supabase/supabase-js@2.57.4','@supabase/supabase-js')
.replace(/<link rel="manifest"[^>]*>/,'').replace(/<link rel="icon"[^>]*>/,'')
.replace('location.origin+"/app/"','"https://propertycare360.co.uk/app/"')
.replace('if(url)window.location.assign(url);','if(url)await openExternal(url);')
.replace('window.location.assign(data.signedUrl);','await openExternal(data.signedUrl);')
.replace('render();}','render();void syncReminders().catch(console.error);}')
.replace('const logged=Boolean(state.user);','const logged=Boolean(state.user);if(!logged)void syncReminders().catch(console.error);')
.replace('el("logoutBtn").onclick=()=>supabase.auth.signOut();','el("logoutBtn").onclick=async()=>{await supabase.auth.signOut();await syncReminders();};')
.replace('if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(console.error));}','')
.replace('<script type="module">','<script type="module">\nimport {setupNative,openExternal} from "./src/native.mjs";')
.replace('function esc(v)','const syncReminders=setupNative({getState:()=>state,reload:()=>loadData(),onReminder:()=>page("bookings")});\nfunction esc(v)')
.replace('</style>','body{padding-top:env(safe-area-inset-top)}.wrap{padding-bottom:calc(100px + env(safe-area-inset-bottom))}input,select,textarea{font-size:16px!important}</style>');
await writeFile('index.html',html);
