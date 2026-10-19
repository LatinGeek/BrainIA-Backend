import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const auth = JSON.parse(readFileSync(join(process.env.APPDATA,'com.vercel.cli','Data','auth.json'),'utf8'));
const token = auth.token ?? auth.authToken;
const project = JSON.parse(readFileSync('.vercel/project.json','utf8'));
const url = `https://api.vercel.com/v9/projects/${project.projectId}/env?decrypt=true&teamId=${project.orgId}`;
const res = await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
const data = await res.json();
console.log('status',res.status,'topKeys',Object.keys(data));
const envs = data.envs ?? data;
console.log('count',Array.isArray(envs)?envs.length:'not-array');
if (Array.isArray(envs)) {
  for (const e of envs) if (/DATABASE|POSTGRES/.test(e.key)) console.log(e.key, JSON.stringify(e.target), 'hasValue', Boolean(e.value), 'type', e.type);
}
