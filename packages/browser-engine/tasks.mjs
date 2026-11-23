// Task Persistence Module
// 任务状态持久化、断点恢复、进度保存

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TASK_DIR = process.env.TASK_DIR || path.join(projectRoot, 'runtime', 'engine-tasks');

export class TaskManager {
  constructor({dir=TASK_DIR}={}) {
    this.dir=dir;
    this._cache=new Map();
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  // --- 创建任务 ---
  create(taskId, plan) {
    if (this._load(taskId)) throw new Error('Task already exists: '+taskId);
    // plan: { name, steps: [{ id, description, status: 'pending'|'done'|'failed', data }] }
    const task = {
      id: taskId,
      name: plan.name,
      steps: plan.steps.map((s, i) => ({
        id: s.id || `step_${i}`,
        description: s.description,
        status: 'pending',
        data: s.data || null,
        result: null,
        error: null,
        startedAt: null,
        completedAt: null,
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: plan.context?.sessionId ? 'preparing' : 'created',
      currentStep: 0,
      context: plan.context || {}, // 共享上下文数据
    };
    this._save(taskId, task);
    return task;
  }

  // --- 获取任务 ---
  get(taskId) {
    return this._load(taskId);
  }

  // --- 列出所有任务 ---
  list() {
    try {
      const files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json'));
      return files.map(f => {
        const task = this._load(f.slice(0, -5));
        return {
          id: task.id,
          name: task.name,
          status: task.status,
          progress: `${task.steps.filter(s => s.status === 'done').length}/${task.steps.length}`,
          updatedAt: task.updatedAt,
        };
      });
    } catch (error) { throw new Error('Cannot read saved tasks: '+error.message); }
  }

  // --- 标记步骤开始 ---
  stepStart(taskId, stepId) {
    const task = this._load(taskId);
    if (!task) return null;
    const step = task.steps.find(s => s.id === stepId);
    if (task.context.sessionId && (task.steps.find(s=>s.status!=='done')!==step || step?.status!=='pending')) throw new Error('Step is not ready; inspect the current task');
    if (step) {
      step.status = 'running';
      step.startedAt = new Date().toISOString();
      task.status = 'running';
      task.currentStep = task.steps.indexOf(step);
      task.updatedAt = new Date().toISOString();
    }
    this._save(taskId, task);
    return task;
  }

  // --- 标记步骤完成 ---
  stepDone(taskId, stepId, result = null) {
    const task = this._load(taskId);
    if (!task) return null;
    const step = task.steps.find(s => s.id === stepId);
    if (task.context.sessionId && step?.status!=='running') throw new Error('Only the running step can complete');
    if (step) {
      step.status = 'done';
      step.result = result;
      step.completedAt = new Date().toISOString();
      task.updatedAt = new Date().toISOString();
      // 检查是否全部完成
      if (task.steps.every(s => s.status === 'done')) {
        task.status = 'completed';
      } else if(task.context.sessionId) task.status='preparing';
    }
    this._save(taskId, task);
    return task;
  }

  // --- 标记步骤失败 ---
  stepFail(taskId, stepId, error) {
    const task = this._load(taskId);
    if (!task) return null;
    const step = task.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'failed';
      task.status = 'failed';
      step.error = error;
      step.completedAt = new Date().toISOString();
      task.updatedAt = new Date().toISOString();
    }
    this._save(taskId, task);
    return task;
  }

  // --- 更新共享上下文 ---
  updateContext(taskId, data) {
    const task = this._load(taskId);
    if (!task) return null;
    Object.assign(task.context, data);
    task.updatedAt = new Date().toISOString();
    this._save(taskId, task);
    return task;
  }

  // --- 获取下一个待执行步骤 ---
  getNextStep(taskId) {
    const task = this._load(taskId);
    if (!task) return null;
    return task.context.sessionId ? task.steps.find(s => s.status !== 'done') : task.steps.find(s=>s.status==='pending'||s.status==='failed');
  }

  // --- 暂停任务 ---
  pause(taskId) {
    const task = this._load(taskId);
    if (!task) return null;
    task.status = 'paused';
    task.updatedAt = new Date().toISOString();
    this._save(taskId, task);
    return task;
  }

  // --- 删除任务 ---
  delete(taskId) {
    const fp = this._path(taskId);
    this._cache.delete(taskId);
    if (fs.existsSync(fp)) { fs.unlinkSync(fp); return true; }
    return false;
  }

  // --- 内部方法 ---
  _save(taskId, task) {
    const fp=this._path(taskId);
    fs.writeFileSync(fp+'.pending', JSON.stringify(task, null, 2));
    fs.renameSync(fp+'.pending',fp);
    const st=fs.statSync(fp);
    this._cache.set(taskId,{mtimeMs:st.mtimeMs,size:st.size,task:structuredClone(task)});
  }

  _load(taskId) {
    const fp = this._path(taskId);
    if (!fs.existsSync(fp)) { this._cache.delete(taskId); return null; }
    const st = fs.statSync(fp);
    const cached = this._cache.get(taskId);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return structuredClone(cached.task);
    }
    const task = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    this._cache.set(taskId, { mtimeMs: st.mtimeMs, size: st.size, task });
    return structuredClone(task);
  }
  _path(id) {
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id||'')) throw new Error('Invalid task ID');
    return path.join(this.dir,`${id}.json`);
  }
}

export default TaskManager;
