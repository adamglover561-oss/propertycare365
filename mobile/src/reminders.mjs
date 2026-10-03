export function upcomingReminders(jobs,now=Date.now()){
 const result=[];
 for(const job of jobs.filter(j=>j.status==='scheduled'&&j.calendar_sync_status==='synced')){
  const at=Date.parse(job.scheduled_for);
  for(const hours of [24,1]){const due=at-hours*3600000;
   if(Number.isFinite(due)&&due>now)result.push({title:'Property Care 365 appointment',body:hours===24?'Your appointment is tomorrow. Open the app for details.':'Your appointment is in one hour. Open the app for details.',schedule:{at:new Date(due)},extra:{jobId:job.id},due});
  }
 }
 return result.sort((a,b)=>a.due-b.due).slice(0,60).map((r,i)=>{const {due,...rest}=r;return {...rest,id:i+1};});
}
