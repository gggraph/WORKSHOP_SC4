#!/usr/bin/env node
"use strict";
const stream = require('stream');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const ini = require('ini');
const tar = require('tar');
const ora = require('ora');
const program = require('commander');
const inquirer = require('inquirer');
const DBPF = require('../lib/dbpf');
const api = require('../lib');
const Savegame = require('../lib/savegame');
const FileType = require('../lib/file-types');
const pkg = require('../package.json');
const { ZoneType } = require('../lib/enums');
const { hex } = require('../lib/util');

const isMain = require.main === module;

const Style = {
	"Chicago": 0x00002000,
	"NewYork": 0x00002001,
	"Houston": 0x00002002,
	"Euro": 0x00002003
};

// Get a reference to commander's command class because we need to set the api 
// & cwd on its prototype.
const Command = program.Command;

// Define getters for the api & cwd on the command's prototype which default 
// to going back up to the main program.
const $cwd$ = Symbol('cwd');
const $api$ = Symbol('api');
Object.defineProperties(Command.prototype, {
	"api": {
		get() { return root(this)[$api$]; },
		set(api) { root(this)[$api$] = api; }
	},
	"cwd": {
		get() { return root(this)[$cwd$]; },
		set(cwd) { root(this)[$cwd$] = cwd; }
	}
});

// # factory(program)
// A factory function that decorates a new commander instance. We need this 
// because for every unit test we need to create a new commander instance, 
// otherwise global state is shared between tests which is a big no no. Have a 
// look at https://github.com/tj/commander.js/issues/438.
function factory(program) {

	// Override the action method if we're not running from the command line. 
	// We mainly use this for testing.
	if (!isMain) {
		const base = Object.getPrototypeOf(program);
		const Command = base.constructor;
		const action = base.action;
		const proto = Object.create(base);
		Command.prototype = proto;

		// Override the action so that we can save a reference to the action.
		proto.action = function(fn) {
			return action.call(this, function(...args) {
				return program._currentCommand = fn.call(this, ...args);
			});
		};

		// Make the cli awaitable when testing.
		program.then = function(...args) {
			return Promise.resolve(this._currentCommand).then(...args);
		};

	}

	// Main program options.
	program
		.name('sc4')
		.option('--no-interactive', 'Disable interactive mode for the commands')
		.version(pkg.version);

	program
		.command('historical <city>')
		.description('Make buildings within the given city historical')
		.option('--force', 'Force override of the city')
		.option('-o, --output <out>', 'The output path to store the city if you\'re not force-overriding')
		.option('-a, --all', 'Make all buildings historical')
		.option('-r, --residential', 'Make all residential buildings historical')
		.option('-c, --commercial', 'Make all commercial buildings historical')
		.option('-i, --industrial', 'Make all industrial buildings historical')
		.option('-g, --agricultural', 'Make all agricultural buildings historical')
		.action(async function(city) {

			// Apparently if someone accidentally uses the command wrong and 
			// types "--force city-name", things go terribly wrong. The 
			// command starts executing and creates a new readable stream, but 
			// apparently on the next tick it decides that the syntax was 
			// incorrect and just force terminates the program, resulting in 
			// an empty file that was force-overwritten. That's a BIG thing, 
			// but we can solve this by only starting the command on the next 
			// tick, which can be force by Promise.resolve().
			await Promise.resolve();

			// Give ourselves our own options hash that we'll populate along 
			// the way and which will be passed to the api.
			const opts = baseOptions();

			let dir = this.cwd;
			let file = opts.dbpf = path.resolve(dir, city);
			let ext = path.extname(file);
			if (ext.toLowerCase() !== '.sc4' || !fs.existsSync(file)) {
				return err(`${file} is not a SimCity 4 savegame!`);
			}

			// Fire up inquirer for an interactive interface, in case we're 
			// not static.
			if (this.parent.interactive) {
				let answers = await inquirer.prompt([{
					"type": "checkbox",
					"name": "types",
					"message": "What type of buildings do you want to make historical?",
					"default": ["residential", "commercial", "agricultural", "industrial"],
					"choices": [{
						"name": "Residential",
						"value": "residential"
					}, {
						"name": "Commercial",
						"value": "commercial"
					}, {
						"name": "Agricultural",
						"value": "agricultural"
					}, {
						"name": "Industrial",
						"value": "industrial"
					}]
				}, {
					"name": "force",
					"type": "confirm",
					"message": [
						`Do you want to override "${path.basename(city)}"?`,
						chalk.yellow(`Don't do this if you have no backup yet!`.toUpperCase())
					].join(' '),
					"default": false
				}, {
					"name": "output",
					"type": "input",
					"message": [
						`Where should I save your city?`,
						`Path is relative to "${dir}".`
					].join(' '),
					"default": 'HISTORICAL-'+path.basename(city),
					when(answers) {
						return !answers.force;
					},
					validate(answer) {
						return Boolean(answer.trim());
					}
				}, {
					"name": "ok",
					"type": "confirm",
					"default": true,
					message(answers) {
						let out = path.resolve(dir, answers.output);
						return `Saving to "${out}", is that ok?`;
					},
					when(answers) {
						return answers.hasOwnProperty('output');
					}
				}]);

				// Not ok? Exit.
				if (!answers.force && !answers.ok) return;

				// Parse answers.
				answers.types.map(type => this[type.toLowerCase()] = true);
				if (answers.force) {
					this.force = true;
				} else {
					this.force = false;
					this.output = answers.output;
				}

			}

			// Parse the output path.
			if (!this.force) {
				if (!this.output) {
					this.output = 'HISTORICAL-'+path.basename(city);
				}
				this.output = path.resolve(dir, this.output);
			} else {
				this.output = file;
			}

			// Prepare our api call.
			if (this.all) opts.all = true;
			if (this.residential) opts.residential = true;
			if (this.commercial) opts.commercial = true;
			if (this.industrial) opts.industrial = true;
			if (this.agricultural) opts.agricultural = true;
			opts.output = this.output;
			opts.save = true;

			// Now call the api.
			return this.api.historical(opts);

		});
    program
        .command('workshop <city>')
        .description('some test for modifying saves')
        .action(async function(city) {
        // Same story here. See historical command.
        await Promise.resolve();
        // Ensure that the city exists first.
			let dir = this.cwd;
			let file = opts.dbpf = path.resolve(dir, city);
			let ext = path.extname(file);
			if (ext.toLowerCase() !== '.sc4' || !fs.existsSync(file)) {
				return err(`${file} is not A SimCity 4 savegame!`);
			}
        });
	program
		.command('growify <city>')
		.description('Convert plopped buildings into functional growables')
		.option('--force', 'Force override of the city')
		.option('-o, --output <out>', 'The output path to store the city if you\'re not force-overriding')
		.option('-r, --residential <type>', 'Zone type of the residential buildings to growify (Low, Medium, High)')
		.option('-i, --industrial <type>', 'Zone type of the industrial buildings to growify (Medium, High)')
		.option('-g, --agricultural', 'Whether or not to growify agricultural buildings as well')
		.option('--no-historical', 'Don\'t make the growified lots historical')
		.action(async function(city) {

			// Same story here. See historical command.
			await Promise.resolve();

			// Create an options object for ourselves that we'll pass to the 
			// api later on.
			const opts = baseOptions();

			// Ensure that the city exists first.
			let dir = this.cwd;
			let file = opts.dbpf = path.resolve(dir, city);
			let ext = path.extname(file);
			if (ext.toLowerCase() !== '.sc4' || !fs.existsSync(file)) {
				return err(`${file} is not A SimCity 4 savegame!`);
			}

			// If we're not running in static mode, go interactive.
			if (this.parent.interactive) {
				let answers = await inquirer.prompt([{
					"name": "types",
					"type": "checkbox",
					"message": "What type(s) of buildings do you want to growify?",
					"default": ["residential", "industrial", "agricultural"],
					"choices": [{
						"name": "Residential buildings",
						"value": "residential"
					}, {
						"name": "Industrial buildings",
						"value": "industrial"
					}, {
						"name": "Agricultural buildings",
						"value": "agricultural"
					}]
				}, {
					"name": "residential",
					"type": "list",
					"message": "What zone should the residential buildings become?",
					"default": 2,
					"choices": [{
						"name": "Low Density",
						"value": ZoneType.RLow
					}, {
						"name": "Medium Density",
						"value": ZoneType.RMedium
					}, {
						"name": "High Density",
						"value": ZoneType.RHigh
					}],
					when(answers) {
						return answers.types.includes('residential');
					}
				}, {
					"name": "industrial",
					"type": "list",
					"message": "What zone should the industrial buildings become?",
					"default": 1,
					"choices": [{
						"name": "Medium Density",
						"value": ZoneType.IMedium
					}, {
						"name": "High Density",
						"value": ZoneType.IHigh
					}],
					when(answers) {
						return answers.types.includes('industrial');
					}
				}, {
					"name": "historical",
					"type": "confirm",
					"message": "Do you want the growified buildings to be historical?",
					"default": true,
					when(answers) {
						return answers.types.length > 0;
					},
				}, {
					"name": "force",
					"type": "confirm",
					"message": [
						`Do you want to override "${path.basename(city)}"?`,
						chalk.yellow(`Don't do this if you have no backup yet!`.toUpperCase())
					].join(' '),
					"default": false,
					when(answers) {
						return answers.types.length > 0;
					}
				}, {
					"name": "output",
					"type": "input",
					"message": [
						`Where should I save your city?`,
						`Path is relative to "${dir}".`
					].join(' '),
					"default": 'GROWIFIED-'+path.basename(city),
					when(answers) {
						return answers.types.length > 0 && !answers.force;
					},
					validate(answer) {
						return Boolean(answer.trim());
					}
				}, {
					"name": "ok",
					"type": "confirm",
					"default": true,
					message(answers) {
						let out = path.resolve(dir, answers.output);
						return `Saving to "${out}", is that ok?`;
					},
					when(answers) {
						return answers.hasOwnProperty('output');
					}
				}]);

				// Not ok? Exit.
				if (!answers.force && !answers.ok) return;

				// Put the answers in the options.
				answers.types.map(type => {
					type = type.toLowerCase();
					if (!answers.hasOwnProperty(type)) {
						this[type] = true;
					} else {
						this[type] = answers[type];
					}
				});

				if (answers.force) {
					this.force = true;
				} else {
					this.force = false;
					this.output = answers.output;	
				}

				// Check if the buildings don't need to be made historical.
				this.historical = answers.historical;

			}

			// Parse the output path.
			if (!this.force) {
				if (!this.output) {
					this.output = 'GROWIFIED-'+path.basename(city);
				}
				this.output = path.resolve(dir, this.output);
			} else {
				this.output = file;
			}

			// Parse residential zone when comming from command line.
			if (!this.parent.interactive) {
				if (this.residential) {
					if (/^l/i.test(this.residential)) {
						this.residential = ZoneType.RLow;
					} else if (/^m/i.test(this.residential)) {
						this.residential = ZoneType.RMedium;
					} else {
						this.residential = ZoneType.RHigh;
					}
				}
				if (this.industrial) {
					if (/^m/i.test(this.industrial)) {
						this.industrial = ZoneType.IMedium;
					} else {
						this.industrial = ZoneType.IHigh;
					}
				}

			}

			// If agricultural is set to true, set it as zone type.
			if (this.agricultural === true) {
				this.agricultural = ZoneType.ILow;
			}

			// Now format the options to pass to the api, regardless of where 
			// we're coming from.
			if (this.residential) opts.residential = this.residential;
			if (this.industrial) opts.industrial = this.industrial;
			if (this.agricultural) opts.agricultural = this.agricultural;
			opts.historical = this.historical;
			opts.output = this.output;
			opts.save = true;

			// Call the api.
			return this.api.growify(opts);

		});

	// Some commands.
	program
		.command('tileset [dir]')
		.description('Set the tilesets for all buildings in the given directory')
		.option('-b, --block', 'Block all buildings from growing')
		.option('-C, --chicago', 'Set the Chicago tileset for all buildings')
		.option('-N, --ny', 'Set the New York tileset for all buildings')
		.option('-H, --houston', 'Set the Houston tileset for all buildings')
		.option('-E, --euro', 'Set the Euro tileset for all buildings')
		.option('-r, --recursive', 'Scan directories recursively')
		.option('--force', 'Force override the files')
		.action(function(dir) {

			let start = new Date();

			if (!dir) {
				dir = process.cwd();
			}
			dir = path.resolve(process.cwd(), dir);

			// Check which tilesets need to be set.
			let sets = [];
			if (this.block) {
				sets.push(0);
			} else  {
				if (this.chicago) sets.push(Style.Chicago);
				if (this.ny) sets.push(Style.NewYork);
				if (this.houston) sets.push(Style.Houston);
				if (this.euro) sets.push(Style.Euro);

				// Ensure that at least 1 tileset has been given.
				if (sets.length === 0) {
					err('You must specify at least 1 tileset! Use --chicago, --ny, --houston and --euro, or use --block to block the buildings from growing!');
					return;
				}

			}

			console.log(chalk.green('SCANNING IN'), dir, chalk.cyan('RECURSIVE?'), !!this.recursive);

			let all = [];
			const force = this.force;
			read(dir, function(file) {

				let name = path.basename(file);

				// Note: if the file starts with zzz_BLOCK_, skip it.
				if (name.match(/^zzz_BLOCK_/)) {
					return;
				}

				let dir = path.dirname(file);
				let buff = fs.readFileSync(file);

				// Check the first 4 bytes. Should be DBPF, otherwise no point in 
				// reading it.
				if (buff.toString('utf8', 0, 4) !== 'DBPF') return;

				console.log(chalk.cyan('SCANNING'), chalk.gray(name));
				let dbpf = new DBPF(buff);
				let shouldSave = false;
				for (let entry of dbpf.exemplars) {

					// Note: not parsing textual exemplars for now, but we should 
					// allow it later on! A parser should be written for it 
					// though...
					let exemplar = entry.read();
					for (let prop of exemplar.props) {
						
						// Look for the "OccupantGroups" property.
						if (prop.id === 0xAA1DD396) {
							chalk.gray('FOUND "OccupantGroups"');

							// Filter out any existing styles.
							shouldSave = true;
							prop.value = prop.value.filter(function(style) {
								return !(Style.Chicago<=style&&style<=Style.Euro);
							});

							// Push in the new styles.
							prop.value.push(...sets);

						}
					}
				}

				if (shouldSave) {
					let override = force ? name : 'zzz_BLOCK_'+name;
					console.log(chalk.green('SAVING TO'), chalk.gray(override));
					override = path.join(dir, override);
					let buff = dbpf.toBuffer();
					fs.writeFileSync(override, buff);
				}
				

			}, !!this.recursive);

			let time = new Date() - start;
			console.log(chalk.green('DONE'), chalk.gray('('+time+'ms)'));

		});

	// Backup command for backup a region or a plugins folder.
	program
		.command('backup')
		.description('Backup a region or your entire plugins folder')
		.option('-R, --region <name>', 'The name of the region to be backuped, or the path to the region\'s directory')
		.option('-P, --plugins [dir]', 'Set this flag if you want to backup your plugins')
		.option('-o, --output [dir]', 'Specify the path to the output directory. Defaults to Current Working Directory.')
		.action(async function() {

			// Find the user's home directory.
			const home = process.env.HOMEPATH;
			const docs = path.join(home, 'documents/SimCity 4');
			
			// Check if either plugins or region was specified.
			if (!this.region && !this.plugins) {
				err('Either specify a region or plugin folder using the --region & --plugins options');
			}

			// Check if a region needs to be backuped.
			if (this.region) {
				let region = this.region;
				let folder;
				if (region === '.') {
					folder = process.cwd();
				} else {
					folder = path.resolve(path.join(docs, 'regions'), region);
				}
				
				// Ensure that the folder exists.
				if (!fs.existsSync(folder)) {
					err(`The region seems not to exist. Looked for "${folder}". You can specify the full path if you want.`);
					return;
				}

				// Okay, region exists. Read the entire directory **recursively** 
				// and add all files.
				let files = [];
				read(folder, function(file) {
					let ext = path.extname(file);
					if (!ext.match(/(\.sc4)|(\.bmp)|(\.png)|(\.ini)/i)) return;
					files.push(path.relative(folder, file));
				}, true);

				// Add the region.ini file manually because we'll override it.
				let date = getDateSuffix();
				// let iniFile = path.resolve(folder, 'region.ini');
				// if (!fs.existsSync(iniFile)) {
				// 	return err('No region.ini found!');
				// }
				// let settings = ini.decode(String(fs.readFileSync(iniFile)));
				// settings['Regional Settings'].Name += ' - '+date;
				// let iniString = ini.encode(settings);
				// let rs = new stream.Readable({
				// 	read() {
				// 		this.push(iniString);
				// 		this.push(null);
				// 	}
				// });
				// files.push(rs);

				// Parse the output path.
				let out = this.output;
				if (!out) {
					out = process.cwd();
				} else {
					out = path.resolve(process.cwd(), out);
				}

				let suffix = date + '.tar.gz';
				let name = path.basename(folder);
				out = path.resolve(out, [name, suffix].join(' - '));

				// If the output directory is the region folder itself, log a 
				// warning as this is not recommended.
				if (path.dirname(out).toLowerCase() === folder.toLowerCase()) {
					warn('You are backuping your region inside the region\'s own folder! This is not recommended! Make sure to move the backup somewhere else!');
				}

				// Create a tar-stream from the entire directory.
				let ws = tar.create({
					"gzip": true,
					"cwd": folder
				}, files).pipe(fs.createWriteStream(out));

				// Show a spinner.
				let spinner = ora();
				spinner.stream = process.stdout;
				spinner.start(`Backing up region "${name}"...`);

				await new Promise(resolve => {
					ws.on('finish', () => resolve());
				});

				spinner.stop();
				ok(`Region ${name} backuped to "${out}"`);

			}

			// Check for the plugins folder as well.
			if (this.plugins) {
				let folder;
				if (this.plugins === true) {
					folder = path.join(docs, 'Plugins');
				} else {
					folder = path.resolve(process.cwd(), this.plugins);
				}

				// Ensure that the plugins folder exists.
				if (!fs.existsSync(folder)) {
					err(`The plugins folder ${folder} does not exist!`);
				}

				// Find the output folder.
				let out = this.output;
				if (!out) {
					out = process.cwd();
				} else {
					out = path.resolve(process.cwd(), out);
				}

				// Ensure that the output folder exists.
				if (!fs.existsSync(out)) {
					return err(`The destination folder ${out} does not exist!`);
				}

				let suffix = getDateSuffix() + '.tar.gz';
				out = path.resolve(out, ['Plugins', suffix].join(' - '));

				// Create a spinner because this can take some time.
				let spinner = ora();
				spinner.stream = process.stdout;
				spinner.start(`Backing up plugins...`);

				let ws = tar.create({
					"gzip": true,
					"cwd": path.dirname(folder)
				}, [path.basename(folder)]).pipe(fs.createWriteStream(out));

				await new Promise(resolve => {
					ws.on('finish', () => resolve());
				});

				spinner.stop();
				ok(`Plugins backuped to "${out}"`);

			}

			// We're done.
			ok('Done');

		});

	// Command for comparing
	program
		.command('dump <city>')
		.description('Give a human-readable representation of all lots in the city')
		.action(function(city) {

			let dir = this.cwd;
			let file = path.resolve(dir, city);
			let buff = fs.readFileSync(file);
			
			let dword = 'crc mem IID dateCreated buildingIID linkedIndustrial linkedAgricultural demandSourceIndex name unknown0'.split(' ');
			let word = 'unknown6'.split(' ');
			let byte = 'flag1 flag2 flag3 zoneType zoneWealth unknown5 orientation type debug'.split(' ');
			function replacer(name, val) {
				if (name === 'commuteBuffer') return val ? "..." : null;
				else if (dword.includes(name)) return hex(val);
				else if (byte.includes(name)) return hex(val, 2);
				else if (word.includes(name)) return hex(val, 4);
				else return val;
			}

			let dbpf = new DBPF(buff);
			let lotFile = dbpf.entries.find(x => x.type === FileType.LotFile).read();
			let all = [];
			for (let lot of lotFile) {
				let str = JSON.stringify(lot, replacer, 2);
				all.push(str);
			}
			console.log(all.join('\n\n-----------------\n\n'));

		});

	// Command for looking for refs.
	program
		.command('refs <city>')
		.option('-m, --max <max>', 'Max amount of references to search for per file type. Defaults to infinity')
		.option('--address <ref>', 'A specific memory reference to look for')
		.option('--types <type>', 'The Type IDs for which we need to look for references')
		.option('-a, --all', 'Finds lot, building, texture & prop references')
		.option('-l, --lots', 'Find lot references')
		.option('-b, --buildings', 'Find building references')
		.option('-t, --textures', 'Find texture references')
		.option('-p, --props', 'Find prop references')
		.description('Finds internal memory references within a city')
		.action(function(city) {
			let dir = this.cwd;
			let file = path.resolve(dir, city);
			let buff = fs.readFileSync(file);
			let opts = baseOptions();
			opts.dbpf = new DBPF(buff);

			if (this.address) {
				opts.address = this.address.split(',').map(x => Number(x));
			} else {
				// If nothing was specified explicitly, set to all by default.
				if (!this.all && !this.lots && !this.buildings && !this.textures && !this.props && !this.types) {
					this.all = true;
				}
                // Build up the queries.
				let queries = opts.queries = {};
               // if (this.lots || this.all) queries.Lot = FileType.ZoneManager;
				if (this.lots || this.all) queries.Lot = FileType.LotFile;
				if (this.buildings || this.all) queries.Building = FileType.BuildingFile;
				if (this.textures || this.all) queries.Texture = FileType.BaseTextureFile;
				if (this.props || this.all) queries.Prop = FileType.PropFile;

				// Handle more types.
				if (this.types) {
					this.types.split(',').forEach(function(type) {
						let nr = Number(type);
						queries[hex(nr)] = nr;
					});
				}

				if (this.max) {
					opts.max = +this.max;
				}

			}

			api.refs(opts);
		});

	// Command for switching the active tilesets in a city.
	program
		.command('tracts <city>')
		.option('-t, --tilesets <tilesets>', 'The tileset identifiers, given as numbers')
		.option('-y, --years <years>', 'The amount of years in the cycle')
		.option('--force', 'Force override the city')
		.description('Changes the active tilesets in the given city')
		.action(async function(city) {
			let dir = this.cwd;
			let file = path.resolve(dir, city);
			let buff = fs.readFileSync(file);
			let dbpf = new DBPF(buff);

			let entry = dbpf.entries.find(entry => entry.type === FileType.TractDeveloper);
			let tracts = entry.read();
			if (!this.tilesets) {
				throw new Error('No tilesets specified!');
			}

			// Parse the tilesets.
			let styles = [];
			for (let style of this.tilesets.split(',')) {
				styles.push(+style);
			}
			tracts.styles = styles;

			if (this.years) {
				tracts.years = +this.years;
			}

			// Save.
			let opts = baseOptions();
			let output = file;
			if (!this.force) {
				let dir = path.dirname(file);
				let name = 'TRACTS_'+path.basename(file);
				output = path.join(dir, name);
			}
			opts.info(`Saving to ${ output }`);
			await dbpf.save({ file: output });

		});

	// End of factory function.
	return program;

}

// # root(cmd)
// Finds the root command of a given command.
function root(cmd) {
	while (cmd.parent) cmd = cmd.parent;
	return cmd;
}

// # read(dir, cb, recursive)
function read(dir, cb, recursive) {

	let stat = fs.statSync(dir);
	if (!stat.isDirectory()) {
		cb(dir);
		return;
	}

	let list = fs.readdirSync(dir);
	for (let entry of list) {
		let full = path.join(dir, entry);
		let stat = fs.statSync(full);
		if (stat.isDirectory()) {
			if (recursive) {
				read(full, cb, recursive);
			}
		} else {
			cb(full);
		}
	}
}

function baseOptions() {
	return {
		"info": info,
		"ok": ok,
		"warn": warn,
		"error": err
	};
}

function ok(...msg) {
	console.log(chalk.green('OK'), ...msg);
}

function err(...msg) {
	console.log(chalk.red('ERROR'), ...msg);
}

function warn(...msg) {
	console.log(chalk.yellow('WARNING'), ...msg);
}

function info(...msg) {
	console.log(chalk.cyan('INFO'), ...msg);
}

function getDateSuffix() {
	let date = new Date();
	let day = [
		date.getFullYear(),
		String(date.getMonth()).padStart(2, '0'),
		String(date.getDay()).padStart(2, '0')
	].join('-');
	
	let time = [
		String(date.getHours()).padStart(2, '0'),
		String(date.getMinutes()).padStart(2, '0'),
		String(date.getSeconds()).padStart(2, '0')
	].join('.');
	return [day, time].join(' ');
}

// Check if we're the main module required - i.e. if someone called the 
// program from the command line. In that case we're going to parse argv.
if (isMain) {

	// Set up all options first.
	factory(program);

	// Set the default api & cwd to be used.
	program.api = api;
	program.cwd = process.cwd();

	// Now run.
	program.parse(process.argv);

	// Display help by default.
	if (program.args.length === 0) {
		program.help();
	}

} else {
	module.exports = function(cmd) {
		return factory(cmd || new program.Command());
	};
}