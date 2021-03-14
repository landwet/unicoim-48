const os = require('os')
const path = require('path')
const fs = require('fs-extra')
var moment = require('moment');
moment.locale('zh-cn');
const { getCookies, saveCookies, delCookiesFile } = require('./util')
const { TryNextEvent, CompleteEvent } = require('./EnumError')
const _request = require('./request')
var crypto = require('crypto');
const { default: PQueue } = require('p-queue');

String.prototype.replaceWithMask = function (start, end) {
    return this.substr(0, start) + '******' + this.substr(-end, end)
}

const randomDate = (options) => {
    let startDate = moment();
    let endDate = moment().endOf('days').subtract(2, 'hours');

    let defaltMinStartDate = moment().startOf('days').add('4', 'hours')
    if (startDate.isBefore(defaltMinStartDate, 'minutes')) {
        startDate = defaltMinStartDate
    }

    if (options && typeof options.startHours === 'number') {
        startDate = moment().startOf('days').add(options.startHours, 'hours')
    }
    if (options && typeof options.endHours === 'number') {
        endDate = moment().startOf('days').add(options.endHours, 'hours')
    }

    return new Date(+startDate.toDate() + Math.random() * (endDate.toDate() - startDate.toDate()));
};
let tasks = {}
let scheduler = {
    taskFile: path.join(os.homedir(), '.AutoSignMachine', 'taskFile.json'),
    today: '',
    isRunning: false,
    isTryRun: false,
    taskJson: undefined,
    queues: [],
    will_tasks: [],
    selectedTasks: [],
    taskKey: 'default',
    clean: async () => {
        scheduler.today = '';
        scheduler.isRunning = false;
        scheduler.isTryRun = false;
        scheduler.taskJson = undefined;
        scheduler.queues = [];
        scheduler.will_tasks = [];
        scheduler.selectedTasks = [];
        scheduler.taskKey = 'default';
    },

   buildQueues: async () => {
    let queues = [];
    let taskNames = Object.keys(tasks);
    for (let taskName of taskNames) {
      let options = tasks[taskName].options;
      let willTime = moment(randomDate(options));
      let waitTime = options.dev ? 0 : Math.floor(Math.random() * 600);
      if (options) {
        if (options.isCircle || options.dev) {
          willTime = moment().startOf("days");
        }
        if (options.startTime) {
          willTime = moment().startOf("days").add(options.startTime, "seconds");
        }
        if (options.ignoreRelay) {
          waitTime = 0;
        }
      }
      if (scheduler.isTryRun) {
        willTime = moment().startOf("days");
        waitTime = 0;
      }
      queues.push({
        taskName: taskName,
        taskState: 0,
        willTime: willTime.format("YYYY-MM-DD HH:mm:ss"),
        waitTime: waitTime,
      });
    }
    return queues;
  },
 initTasksQueue: async () => {
    const today = moment().format("YYYYMMDD");
    if (!fs.existsSync(scheduler.taskFile)) {
      console.log("📑 美女嫖资不存在，创建资产中");
      let queues = await scheduler.buildQueues();
      fs.createFileSync(scheduler.taskFile);
      fs.writeFileSync(
        scheduler.taskFile,
        JSON.stringify({
          today,
          queues,
        })
      );
      console.log("📑 任务配置文件创建完毕 等待5秒再继续");
      // eslint-disable-next-line no-unused-vars
      await new Promise((resolve, reject) => setTimeout(resolve, 5 * 1000));
    } else {
      let taskJson = fs.readFileSync(scheduler.taskFile).toString("utf-8");
      taskJson = JSON.parse(taskJson);
      if (taskJson.today !== today) {
        console.log("📑  日期已变更，重新生成任务配置");
        let queues = await scheduler.buildQueues();
        fs.writeFileSync(
          scheduler.taskFile,
          JSON.stringify({
            today,
            queues,
          })
        );
        console.log("📑 任务配置文件更新完毕 等待5秒再继续");
        // eslint-disable-next-line no-unused-vars
        await new Promise((resolve, reject) => setTimeout(resolve, 5 * 1000));
      }

      if (taskJson.queues.length !== Object.keys(tasks).length) {
        console.log("📑 数量已变更，重新生成任务配置");
        let queues = await scheduler.buildQueues();
        fs.writeFileSync(
          scheduler.taskFile,
          JSON.stringify({
            today,
            queues,
          })
        );
        console.log("📑 任务配置文件更新完毕 等待5秒再继续");
        // eslint-disable-next-line no-unused-vars
        await new Promise((resolve, reject) => setTimeout(resolve, 5 * 1000));
      }
    }
    scheduler.today = today;
  },
    genFileName(command) {
        if (process.env.asm_func === 'true') {
            // 暂不支持持久化配置，使用一次性执行机制，函数超时时间受functions.timeout影响
            scheduler.isTryRun = true
        }
        let dir = process.env.asm_save_data_dir
        if (!fs.existsSync(dir)) {
            fs.mkdirpSync(dir)
        }
        scheduler.taskFile = path.join(dir, `taskFile_${command}_${scheduler.taskKey}.json`)
        process.env['taskfile'] = scheduler.taskFile
        scheduler.today = moment().format('YYYYMMDDHHSS')
        let maskFile = path.join(dir, `taskFile_${command}_${scheduler.taskKey.replaceWithMask(2, 3)}.json`)
        console.info('🚨获得淫嫖房间🚨', maskFile, '当前日期', scheduler.today)
    },
    loadTasksQueue: async (selectedTasks) => {
        let queues = []
        let will_tasks = []
        let taskJson = {}
        if (fs.existsSync(scheduler.taskFile)) {
            taskJson = fs.readFileSync(scheduler.taskFile).toString('utf-8')
            taskJson = JSON.parse(taskJson)
            if (taskJson.today === scheduler.today) {
                if (scheduler.isTryRun) {
                    queues = taskJson.queues
                } else {
                    queues = taskJson.queues.filter(t =>
                        // 未处于运行状态
                        (!t.isRunning) ||
                        // 处于运行状态且超过了运行截止时间
                        (t.isRunning && t.runStopTime && moment(t.runStopTime).isBefore(moment(), 'minutes'))
                    )
                    if (taskJson.queues.length !== queues.length) {
                        console.info('跳过以下正在执行的任务', taskJson.queues.filter(t =>
                            // 处于运行状态未设置截止时间
                            (t.isRunning && !t.runStopTime) ||
                            // 处于运行状态且还未到运行截止时间
                            (t.isRunning && t.runStopTime && moment(t.runStopTime).isAfter(moment(), 'minutes'))
                        ).map(t => t.taskName).join(','))
                    }
                }
            } else {
                console.info('日期配置已失效')
            }
            if (scheduler.isTryRun) {
                fs.unlinkSync(scheduler.taskFile)
            }
        } else {
            console.info('配置文件不存在')
        }

        if (Object.prototype.toString.call(selectedTasks) == '[object String]') {
            selectedTasks = selectedTasks.split(',').filter(q => q)
        } else {
            selectedTasks = []
        }

        if (scheduler.isTryRun) {
            will_tasks = queues.filter(task => (!selectedTasks.length || selectedTasks.length && selectedTasks.indexOf(task.taskName) !== -1))
        } else {
            will_tasks = queues.filter(task =>
                task.taskName in tasks &&
                task.taskState === 0 &&
                moment(task.willTime).isBefore(moment(), 'seconds') &&
                (!selectedTasks.length || selectedTasks.length && selectedTasks.indexOf(task.taskName) !== -1)
            )
        }

        scheduler.taskJson = taskJson
        scheduler.queues = queues
        scheduler.will_tasks = will_tasks
        scheduler.selectedTasks = selectedTasks
        console.info('计算可嫖少妇', '总少妇数', queues.length, '已完成通道数', queues.filter(t => t.taskState === 1).length, '错误少妇数', queues.filter(t => t.taskState === 2).length, '指定少妇数', selectedTasks.length, '预计可嫖少妇数', will_tasks.length)
        return {
            taskJson,
            queues,
            will_tasks
        }
    },
    regTask: async (taskName, callback, options) => {
        tasks[taskName] = {
            callback,
            options
        }
    },
    hasWillTask: async (command, params) => {
        const { taskKey, tryrun, tasks: selectedTasks } = params
        scheduler.clean()
        scheduler.isTryRun = tryrun
        scheduler.taskKey = taskKey || 'default'
        if (scheduler.isTryRun) {
            console.info('⚠️温馨提示您已进入少妇房间☢安全并快速进去战斗⚠️')
            await new Promise((resolve) => setTimeout(resolve, 3000))
        }
        process.env['taskKey'] = [command, scheduler.taskKey].join('_')
        process.env['command'] = command
        console.info('🎴获得嫖客识别码🃏', scheduler.taskKey.replaceWithMask(2, 3), '㊙️')
        await scheduler.genFileName(command)
        await scheduler.initTasksQueue()
        let { will_tasks } = await scheduler.loadTasksQueue(selectedTasks)
        scheduler.isRunning = true
        return will_tasks.length
    },
    execTask: async (command) => {
        console.info('🚀已驶入少妇房间,自动战斗1⃣小时床震操作☢')
        if (!scheduler.isRunning) {
            await scheduler.genFileName(command)
            await scheduler.initTasksQueue()
        }

        let { taskJson, queues, will_tasks, selectedTasks } = scheduler

        if (selectedTasks.length) {
            console.info('将只执行选择的任务', selectedTasks.join(','))
        }

    if (will_tasks.length) {
      //TODO: deprecated Cookies will be deleted on TryRun mode
      // if (scheduler.isTryRun) {
      //   console.log("👉 TryRun模式将清除CK操作");
      //   await delCookiesFile([command, scheduler.taskKey].join("_"));
      // }
      // 初始化处理
      let init_funcs = {};
      let init_funcs_result = {};
      for (let task of will_tasks) {
        let ttt = tasks[task.taskName];
        let tttOptions = ttt.options || {};
        let savedCookies =
          getCookies([command, scheduler.taskKey].join("_")) ||
          tttOptions.cookies;
        let request = _request(savedCookies);

        if (tttOptions.init) {
          if (
            Object.prototype.toString.call(tttOptions.init) ===
            "[object AsyncFunction]"
          ) {
            let hash = crypto
              .createHash("md5")
              .update(tttOptions.init.toString())
              .digest("hex");
            if (!(hash in init_funcs)) {
              init_funcs_result[task.taskName + "_init"] = await tttOptions[
                "init"
              ](request, savedCookies);
              init_funcs[hash] = task.taskName + "_init";
            } else {
              init_funcs_result[task.taskName + "_init"] =
                init_funcs_result[init_funcs[hash]];
            }
          } else {
            console.log("not apply");
          }
        } else {
          init_funcs_result[task.taskName + "_init"] = { request };
        }
      }

      // 任务执行
      
      let concurrency = scheduler.isTryRun ? 2 : 2
      let queue = new PQueue({ concurrency: 6 });
      console.log("👉 调度任务中", "并发数", 6);
      for (let task of will_tasks) {
        queue.add(async () => {
          try {
            if (task.waitTime) {
              console.log(
                "☕ 延迟执行",
                task.taskName,
                task.waitTime,
                "seconds"
              );
              // eslint-disable-next-line no-unused-vars
              await new Promise((resolve, reject) =>
                setTimeout(resolve, task.waitTime * 1000)
              );
            }

            let ttt = tasks[task.taskName];
            if (
              Object.prototype.toString.call(ttt.callback) ===
              "[object AsyncFunction]"
            ) {
              await ttt.callback.apply(
                this,
                Object.values(init_funcs_result[task.taskName + "_init"])
              );
            } else {
              console.log("❌ 任务执行内容空");
            }

            let isupdate = false;
            let newTask = {};
            if (ttt.options) {
              if (!ttt.options.isCircle) {
                newTask.taskState = 1;
                isupdate = true;
              }
              if (ttt.options.isCircle && ttt.options.intervalTime) {
                newTask.willTime = moment()
                  .add(ttt.options.intervalTime, "seconds")
                  .format("YYYY-MM-DD HH:mm:ss");
                isupdate = true;
              }
            } else {
              newTask.taskState = 1;
              isupdate = true;
            }

            if (isupdate) {
              let taskindex = queues.findIndex(
                (q) => q.taskName === task.taskName
              );
              if (taskindex !== -1) {
                taskJson.queues[taskindex] = {
                  ...task,
                  ...newTask,
                };
              }
              fs.writeFileSync(scheduler.taskFile, JSON.stringify(taskJson));
              console.log("📑 任务配置文件更新完毕 等待5秒再继续");
              // eslint-disable-next-line no-unused-vars
              await new Promise((resolve, reject) =>
                setTimeout(resolve, 5 * 1000)
              );
            }
          } catch (err) {
            console.log("❌ 任务错误：", err);
          }
        });
      }
      await queue.onIdle();
    } else {
      console.log("⭕ 暂无需要执行的任务");
    }
  },
};
module.exports = {
    scheduler
}