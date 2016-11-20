const colorJSON = require('json-colorz');
const commandLineArgs = require('command-line-args');
const fs = require('fs');
const isJSON = require('is-json');
const package = require('./package.json');
const painlessConfig = require('painless-config');
const process = require('process');
const readline = require('readline');
const split = require('argv-split');

const args = getArgs();
const options = getOptions(args);
if (options.help) {
  console.log(getUsage(args));
  return;
}
if (options.version) {
  console.log(getVersion());
  return;
}

const firstConnect = true;
const client = connect(options).then(() => startReplLoop);

let lastReply;
function startReplLoop() {
  const commands = getCommands();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.setPrompt(options.hostname + '> ');
  rl.prompt();

  rl.on('line', (line) => {
    const command = split(line);

    const commandName = command.length === 0 ? 'NOOP' : command[0].toUpperCase();
    let commandArgs = command.splice(1);
    let commandFunc = commands[commandName];
    if (!commandFunc) {
      commandFunc = commands.HELP;
      commandArgs = [];
      console.error('Unknown command \'' + commandName + '\', valid commands are:');
    }

    commandFunc(commandName, commandArgs, (err, reply) => {
      if (err) console.error(err);
      if (reply) displayReply(reply);
      lastReply = reply;
      rl.prompt();
    });
  }).on('close', () => {
    process.exit(0);
  });
}

function getVersion() {
  return package.name + ' ' + package.version;
}

function getArgs() {
  const cli = commandLineArgs([
    { name: 'hostname', alias: 'h', type: String, defaultValue: painlessConfig.get('REDIS_HOSTNAME') || '127.0.0.1' },
    { name: 'password', alias: 'a', type: String, defaultValue: painlessConfig.get('REDIS_PASSWORD') },
    { name: 'queue', alias: 'q', type: String },
    { name: 'push', alias: 'p', type: String },
    { name: 'type', alias: 't', type: String, defaultValue: 'amqp' },
    { name: 'version', alias: 'v', type: Boolean },
    { name: 'help', alias: '?', type: Boolean }
  ]);

  return cli;
}

function getOptions(args) {
  const options = args.parse();
  return options;
}

function getUsage(args) {
  return args.getUsage({ title: getVersion(), description: package.description });
}

function getCommands() {
  var commands = {};
  for (var i = 0; i < redisCommands.list.length; i++) {
    commands[redisCommands.list[i].toUpperCase()] = client.send_command.bind(client);
  }
  commands[''] = noopCommand;
  commands.HELP = helpCommand;
  commands.NOOP = noopCommand;
  commands.EXIT = quitCommand;
  commands.QUIT = quitCommand;
  commands.SAVE = saveCommand;
  return commands;
}

function displayReply(reply) {
  // Formatters
  if (typeof reply === 'string') {
    if (isJSON(reply)) {
      reply = JSON.parse(reply);
    }
  }

  // Renderers
  if (typeof reply === 'string') {
    console.log(reply);
  } else {
    colorJSON(reply);
  }
}



function connect() {
  const logger = OspoCrawler.createLogger(false, true);
  const queues = OspoCrawler.createQueues(options.type, options.queue, logger);
  return queues.subscribe();
}



const logger = OspoCrawler.createLogger(false, true);
const queues = OspoCrawler.createQueues(options.type, options.queue, logger);
queues.subscribe().then(() => {
  const seedRequests = [OspoCrawler.createSeedRequest('orgs', 'https://api.github.com/user/orgs', 'urn:microsoft/orgs')];
  return queues.push(seedRequests).finally(() => process.exit());
});
