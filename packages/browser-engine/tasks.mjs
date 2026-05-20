// Task Persistence Module
// 任务状态持久化、断点恢复、进度保存

import fs from 'node:fs';
import path from 'node:path';

const TASK_DIR = process.env.TASK_DIR || path.join(process.cwd(), '.tasks');

export class TaskManager {
  constructor() {
    if (!fs.existsSync(TASK_DIR)) fs.mkdirSync(TASK_DIR, { recursive: true });
  }

  // --- 创建任务 ---
  create(taskId, plan) {
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
      status: 'created', // created | running | paused | completed | failed
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
      const files = fs.readdirSync(TASK_DIR).filter(f => f.endsWith('.json'));
      return files.map(f => {
        const task = JSON.parse(fs.readFileSync(path.join(TASK_DIR, f), 'utf-8'));
        return {
          id: task.id,
          name: task.name,
          status: task.status,
          progress: `${task.steps.filter(s => s.status === 'done').length}/${task.steps.length}`,
          updatedAt: task.updatedAt,
        };
      });
    } catch { return []; }
  }

  // --- 标记步骤开始 ---
  stepStart(taskId, stepId) {
    const task = this._load(taskId);
    if (!task) return null;
    const step = task.steps.find(s => s.id === stepId);
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
    if (step) {
      step.status = 'done';
      step.result = result;
      step.completedAt = new Date().toISOString();
      task.updatedAt = new Date().toISOString();
      // 检查是否全部完成
      if (task.steps.every(s => s.status === 'done')) {
        task.status = 'completed';
      }
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
    return task.steps.find(s => s.status === 'pending' || s.status === 'failed');
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
    const fp = path.join(TASK_DIR, `${taskId}.json`);
    if (fs.existsSync(fp)) { fs.unlinkSync(fp); return true; }
    return false;
  }

  // --- 内部方法 ---
  _save(taskId, task) {
    fs.writeFileSync(path.join(TASK_DIR, `${taskId}.json`), JSON.stringify(task, null, 2));
  }

  _load(taskId) {
    const fp = path.join(TASK_DIR, `${taskId}.json`);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  }
}

export default TaskManager;
