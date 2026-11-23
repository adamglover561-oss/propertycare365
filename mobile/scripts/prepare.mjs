import { readFile,writeFile } from 'node:fs/promises';
let html=await readFile('../public/app/index.html','utf8');
const brandCss=await readFile('../public/brand.css','utf8');
html=html.replace('<link rel="stylesheet" href="/brand.css?v=20261012">', '<style>'+brandCss+'</style>');
html=html.replace('https://esm.sh/@supabase/supabase-js@2.57.4','@supabase/supabase-js')
.replace(/<link rel="manifest"[^>]*>/,'').replace(/<link rel="icon"[^>]*>/,'')
.replace('location.origin+"/app/"','"https://propertycare360.co.uk/app/"')
.replace('window.location.assign(url);','await openExternal(url);')
.replace('window.location.assign(data.signedUrl);','await openExternal(data.signedUrl);')
.replace('render();}','render();void syncReminders().catch(console.error);}')
.replace('const logged=Boolean(state.user);','const logged=Boolean(state.user);if(!logged)void syncReminders().catch(console.error);')
.replace('await applySession(null);','await applySession(null);await Promise.race([syncReminders().catch(console.error),new Promise(resolve=>setTimeout(resolve,2000))]);')
.replace('if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(console.error));}','')
.replace('<script type="module">','<script type="module">\nimport {setupNative,openExternal} from "./src/native.mjs";')
.replace('function esc(v)','const syncReminders=setupNative({getState:()=>state,reload:()=>loadData(),onReminder:()=>page("bookings")});\nfunction esc(v)')
.replace('</style>','body{padding-top:env(safe-area-inset-top)}.wrap{padding-bottom:calc(100px + env(safe-area-inset-bottom))}input,select,textarea{font-size:16px!important}</style>');

// Keep the owner shortcut in the mobile build and let the admin portal authenticate independently.
const ownerShortcut = `
let ownerAccessCheck = 0;
async function refreshOwnerShortcut(user) {
  const check = ++ownerAccessCheck;
  const button = el("ownerDashboardBtn");
  button.classList.add("hidden");
  if (!user) return;

  try {
    const { data, error } = await supabase.rpc("is_home_care_admin");
    if (check === ownerAccessCheck && !error && data === true) {
      button.classList.remove("hidden");
    }
  } catch (error) {
    console.error("Could not check owner access:", error);
  }
}

el("ownerDashboardBtn").addEventListener("click", () => {
  void openExternal("https://propertycare360.co.uk/admin/").catch(error => {
    console.error(error);
    alert("Open propertycare360.co.uk/admin/ in your browser to access the owner dashboard.");
  });
});
`;
const ownerShortcutChanges = [
  ['<button id="logoutBtn"', '<button id="ownerDashboardBtn" class="btn secondary hidden" type="button">Owner Dashboard</button><button id="logoutBtn"'],
  ['async function applySession(session)', ownerShortcut + 'async function applySession(session)'],
  ['const logged=Boolean(state.user);', 'const logged=Boolean(state.user);void refreshOwnerShortcut(state.user);'],
];
for (const [anchor, replacement] of ownerShortcutChanges) {
  if (!html.includes(anchor)) throw new Error('Missing mobile owner shortcut anchor: ' + anchor);
  html = html.replace(anchor, () => replacement);
}

await writeFile('index.html',html);
