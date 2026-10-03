import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { LocalNotifications } from '@capacitor/local-notifications';
import { upcomingReminders } from './reminders.mjs';
export async function openExternal(url){const target=new URL(url);if(!['https:','mailto:','tel:'].includes(target.protocol))throw new Error('Unsupported link');if(target.protocol==='https:')await Browser.open({url:target.href});else window.location.assign(target.href);}
export function setupNative({getState,reload,onReminder}){
 let queue=Promise.resolve();
 const sync=()=>{queue=queue.catch(console.error).then(async()=>{
  const pending=await LocalNotifications.getPending();if(pending.notifications.length)await LocalNotifications.cancel(pending);
  if(!getState().user||localStorage.getItem('appointment-reminders')!=='on')return;
  if((await LocalNotifications.checkPermissions()).display!=='granted')return;
  const notifications=upcomingReminders(getState().jobs);if(notifications.length)await LocalNotifications.schedule({notifications});
 });return queue;};
 const button=document.createElement('button');button.className='btn secondary';
 const card=document.createElement('div');card.className='card stack';card.innerHTML='<h3>Phone reminders</h3><p class="muted small">Optional notifications for confirmed appointments, one day and one hour before. Open the app regularly to keep them up to date.</p>';card.append(button);document.getElementById('homePage').append(card);
 const update=()=>button.textContent=localStorage.getItem('appointment-reminders')==='on'?'Turn off appointment reminders':'Enable appointment reminders';update();
 button.onclick=async()=>{try{if(localStorage.getItem('appointment-reminders')==='on')localStorage.removeItem('appointment-reminders');else{const p=await LocalNotifications.requestPermissions();if(p.display!=='granted'){alert('Notifications are disabled. You can enable them in phone settings.');return;}localStorage.setItem('appointment-reminders','on');}update();await sync();}catch(e){alert('Could not update reminders: '+e.message);}};
 document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(!link)return;event.preventDefault();void openExternal(new URL(link.getAttribute('href'),'https://propertycare360.co.uk').href).catch(e=>alert(e.message));});
 App.addListener('appStateChange',({isActive})=>{if(isActive&&getState().user)void reload().catch(console.error);});
 App.addListener('backButton',({canGoBack})=>{if(canGoBack)history.back();else onReminder();});
 LocalNotifications.addListener('localNotificationActionPerformed',()=>onReminder());
 return sync;
}
