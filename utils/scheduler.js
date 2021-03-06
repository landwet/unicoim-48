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
      console.log("???? ???????????????????????????????????????");
      let queues = await scheduler.buildQueues();
      fs.createFileSync(scheduler.taskFile);
      fs.writeFileSync(
        scheduler.taskFile,
        JSON.stringify({
          today,
          queues,
        })
      );
      console.log("???? ?????????????????????????????? ??????5????????????");
      // eslint-disable-next-line no-unused-vars
      await new Promise((resolve, reject) => setTimeout(resolve, 5 * 1000));
    } else {
      let taskJson = fs.readFileSync(scheduler.taskFile).toString("utf-8");
      taskJson = JSON.parse(taskJson);
      if (taskJson.today !== today) {
        console.log("????  ??????????????????????????????????????????");
        let queues = await scheduler.buildQueues();
        fs.writeFileSync(
          scheduler.taskFile,
          JSON.stringify({
            today,
            queues,
          })
        );
        console.log("???? ?????????????????????????????? ??????5????????????");
        // eslint-disable-next-line no-unused-vars
        await new Promise((resolve, reject) => setTimeout(resolve, 5 * 1000));
      }

      if (taskJson.queues.length !== Object.keys(tasks).length) {
        console.log("???? ??????????????????????????????????????????");
        let queues = await scheduler.buildQueues();
        fs.writeFileSync(
          scheduler.taskFile,
          JSON.stringify({
            today,
            queues,
          })
        );
        console.log("???? ?????????????????????????????? ??????5????????????");
        // eslint-disable-next-line no-unused-vars
        await new Promise((resolve, reject) => setTimeout(resolve, 5 * 1000));
      }
    }
    scheduler.today = today;
  },
    genFileName(command) {
        if (process.env.asm_func === 'true') {
            // ?????????????????????????????????????????????????????????????????????????????????functions.timeout??????
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
        console.info('??????????????????????????', maskFile, '????????????', scheduler.today)
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
                        // ?????????????????????
                        (!t.isRunning) ||
                        // ????????????????????????????????????????????????
                        (t.isRunning && t.runStopTime && moment(t.runStopTime).isBefore(moment(), 'minutes'))
                    )
                    if (taskJson.queues.length !== queues.length) {
                        console.info('?????????????????????????????????', taskJson.queues.filter(t =>
                            // ???????????????????????????????????????
                            (t.isRunning && !t.runStopTime) ||
                            // ????????????????????????????????????????????????
                            (t.isRunning && t.runStopTime && moment(t.runStopTime).isAfter(moment(), 'minutes'))
                        ).map(t => t.taskName).join(','))
                    }
                }
            } else {
                console.info('?????????????????????')
            }
            if (scheduler.isTryRun) {
                fs.unlinkSync(scheduler.taskFile)
            }
        } else {
            console.info('?????????????????????')
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
        console.info('??????????????????', '????????????', queues.length, '??????????????????', queues.filter(t => t.taskState === 1).length, '???????????????', queues.filter(t => t.taskState === 2).length, '???????????????', selectedTasks.length, '?????????????????????', will_tasks.length)
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
            console.info('??????????????????????????????????????????????????????????????????????????????')
            await new Promise((resolve) => setTimeout(resolve, 3000))
        }
        process.env['taskKey'] = [command, scheduler.taskKey].join('_')
        process.env['command'] = command
        console.info('?????????????????????????????', scheduler.taskKey.replaceWithMask(2, 3), '??????')
        await scheduler.genFileName(command)
        await scheduler.initTasksQueue()
        let { will_tasks } = await scheduler.loadTasksQueue(selectedTasks)
        scheduler.isRunning = true
        return will_tasks.length
    },
    execTask: async (command) => {
        console.info('?????????????????????????,????????????1????????????????????????')
        if (!scheduler.isRunning) {
            await scheduler.genFileName(command)
            await scheduler.initTasksQueue()
        }

        let { taskJson, queues, will_tasks, selectedTasks } = scheduler

        if (selectedTasks.length) {
            console.info('???????????????????????????', selectedTasks.join(','))
        }

    if (will_tasks.length) {
      //TODO: deprecated Cookies will be deleted on TryRun mode
      // if (scheduler.isTryRun) {
      //   console.log("???? TryRun???????????????CK??????");
      //   await delCookiesFile([command, scheduler.taskKey].join("_"));
      // }
      // ???????????????
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

      // ????????????
      
      let concurrency = scheduler.isTryRun ? 2 : 2
      let queue = new PQueue({ concurrency: 6 });
      console.log("???? ???????????????", "?????????", 6);
      for (let task of will_tasks) {
        queue.add(async () => {
          try {
            if (task.waitTime) {
              console.log(
                "??? ????????????",
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
              console.log("??? ?????????????????????");
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
              console.log("???? ?????????????????????????????? ??????5????????????");
              // eslint-disable-next-line no-unused-vars
              await new Promise((resolve, reject) =>
                setTimeout(resolve, 5 * 1000)
              );
            }
          } catch (err) {
            console.log("??? ???????????????", err);
          }
        });
      }
      await queue.onIdle();
    } else {
      console.log("??? ???????????????????????????");
    }
  },
};
module.exports = {
    scheduler
}