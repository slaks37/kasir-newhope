import {createHash} from 'node:crypto';
export const workspaceProductRef=(moduleId:string,recordId:string)=>'workspace:'+createHash('sha256').update(moduleId+'\0'+recordId).digest('hex');
