/*global console, require, requirejs, document, Promise */
require.nodeRequire = window.requireNode;
requirejs.config({
	paths: {
		"domReady": "../jslib/domReady"
		// JS libraries
		,"jquery": "../jslib/jquery-2.1.0"
		,"jqueryUI": "../jslib/jquery-ui.min"

		,"test": "../js/tests/Tests"
		,"text": "../jslib/text"	// Lets require load plain text, used by jsx

		// Custom libraries
		,"underscore" : "../jslib/underscore-min"
		,"util": "../jslib/util"
		,"log": "../jslib/log"

		// CiF
		,"cif" : "../js/CiF/CiF"
		,"sfdb" : "../js/CiF/SFDB"
		,"ruleLibrary" : "../js/CiF/RuleLibrary"
		,"volition": "../js/CiF/Volition"
		,"validate": "../js/CiF/Validate"
		,"actionLibrary": "../js/CiF/ActionLibrary"

		// Tool
		,"historyViewer" : "historyViewer"
		,"rulesViewer" : "rulesViewer"
		,"rulesEditor" : "rulesEditor"
		,"messages" : "messages"
		,"ruleTester" : "ruleTester"
		// ,"ui" : "ui"


},

	// Shims let certain libraries that aren't built with the module pattern interface with require.js 
	// Basically they tell require.js what global variable the given library will try to export all its functionality to, so require.js can do with that what it will.
	shim : {
		"underscore" : {
			exports : "_"
		},
		"jqueryUI" : {
			exports : '$',
			deps	: ['jquery']
		}
	}
});

requirejs(["cif", "sfdb", "actionLibrary", "historyViewer", "rulesViewer", "rulesEditor", "ruleTester", "jquery", "util", "text!../data/socialData.json", "text!../data/cif-test-chars.json", "text!../data/testState.json", "text!../data/testTriggerRules.json", "text!../data/testVolitionRules.json", "text!../data/testActions.json", "jqueryUI", "domReady!"], 
function(cif, sfdb, actionLibrary, historyViewer, rulesViewer, rulesEditor, ruleTester, $, util, sampleData, sampleChars, testSfdbData, testTriggerRules, testVolitionRules, testActions){

	var autoLoad = true;

	var socialStructure;
	var characters;

	var maxBackupFiles = 10;

	// stores the origins of all loaded rules.
	// For now, we assume that the fileName field within the rule matches the filename of the file it came from. TODO: possible to do this automatically?
	var ruleOriginsTrigger = [];
	var ruleOriginsVolition = [];

	$("#tabs").tabs({
		activate: function( event, ui ) {
			if (ui.newPanel[0].id === "tabsSfdb") {
				historyViewer.refresh(sfdb.getCurrentTimeStep());
			}
		}
	});
	$("#rulesTabs").tabs({
		activate: function( event, ui ) {
		}
	}).addClass( "ui-tabs-vertical ui-helper-clearfix" );

	// Show the results of a console command on the screen.
	var cmdLog = function(msg, notAnError) {
		var cr = $("#consoleResults");
		var classes = "ciflog" + (notAnError ? "" : " ciflogerror");
		cr.append("<p class='" + classes + "'>" + msg + "</p>");
		var t = $("#tabsConsole");
		t[0].scrollTop = t[0].scrollHeight;
	};


	$("#cmdSet").tooltip({content: "<p>Use <b>set</b> to change any social fact. Parameter order doesn't matter except for character order in directed facts:</p><ul><li><b>set(Bob, Al, friends)</b></li><li><b>set(bob, trust, al, 75)</b></li><li><b>set(happy, al)</b></li><li><b>set(carla, attracted to, bob, false)</b></li></ul>"});
	$("#cmdUnset").tooltip({content: "<p>Use <b>unset</b> to make a boolean value false:</p><ul><li><b>unset(al, happy)</b></li><li><b>unset(al, involved with, veronica)</b></li></ul>"});
	$("#cmdVolitions").tooltip({content: "<p>Use <b>volitions</b> to see the current ranked volitions from the first character to the second.</p><ul><li>volitions(al, bob)</b> :: <i>shows what changes in the social state Al most wants towards Bob</i></li><li>volitions(Carla)</b> :: <i>Shows Carla's volitions towards everyone else.</i></li></ul>"});
	$("#cmdNext").tooltip({content: "<p>Use <b>next</b> to advance the timestep.</p><ul><li><b>next()</b></li></ul>"});
	$("#cmdShow").tooltip({content: "<p>Use <b>show</b> to see all currently true info about a character.</p><ul><li><b>show(diane)</b></li></ul>"});
	$("#cmdActions").tooltip({content: "<p>Use <b>actions</b> to see an ordrered list of actions the first character wants to take towards the second.</p><ul><li><b>actions(al, diane, 3)</b> :: <i>shows the top three actions Al wants to take towards Diane</i></li><li><b>actions(bob)</b> :: <i> Shows the top action Bob wants to take towards everyone else.</i></li></ul>"});
	$("#cmdDoAction").tooltip({content: "<p>Use <b>doAction</b> to perform an action from the first character to second. The social state will be updated to reflect the results of the actions. Use the <b>actions</b> command to get the numbers of potential actions.</p><ul><li><b>doAction(al, diane, 0)</b> :: <i>performs 'action 0' from Al to Diane</i></li><li><b>doAction(bob, jane, reminisce)</b> :: <i> Make Bob reminisce with Jane.</i></li></ul>"});


	$("button#loadSchema").click(function(){
		if (fs === undefined) {
			alert("File I/O is only possible in the standalone CiF app.");
		} else {
			loadPackage();
		}
	});

	$("button#timeStepForward").click(historyViewer.stepForward);
	$("button#timeStepBack").click(historyViewer.stepBack);
	$("button#resetSFDBHistory").click(historyViewer.reset);


	var backupRulesFile = function(ruleFile) {
		// Create a backup folder for the current schema, if none exists
		// TODO: Limit the number of backups of any specific file to a globally defined amount.

		var path = lastPath;
		var backupFolderName = "_bak_" + ruleFile;
		var backupPath = path + "/" + backupFolderName;
		var origFilePath = path + "/" + ruleFile + ".json";
		var backupFilePath = backupPath + "/" + ruleFile + "_" + getDateTimeStamp() + ".json";

		if (fs !== undefined) {
			if (!fs.existsSync(origFilePath)) {
				return;
			}
			if (!fs.existsSync(backupPath)) {
				fs.mkdirSync(backupPath);
			}
			// Cycle backup files if we have too many.
			var backupFiles = fs.readdirSync(backupPath);
			// Only consider files in this directory that start with the master filename and end with .json
			backupFiles = backupFiles.filter(function(f) {
				return f.split("_")[0] === ruleFile && f.substr(f.length - 5) === ".json";
			})
			if (backupFiles.length > maxBackupFiles) {
				// Since our timestamp will make files sort alphabetically by earliest to latest, we can get the oldest file by just getting the first entry in the sorted file list.
				backupFiles.sort();
				var oldestFileName = backupFiles[0];
				console.log("More than maxBackupFiles files (" + maxBackupFiles + "), so deleting oldest file: " + oldestFileName);
				fs.unlinkSync(backupPath + "/" + oldestFileName);
			}
		}
		console.log("Making folder at ", backupPath);

		// Copy the current version of the rules file to the backup folder, giving it a named timestamp.
		console.log("copying '" + origFilePath + "' to '" + backupFilePath);		
		if (fs !== undefined) {
			var f = fs.readFileSync(origFilePath);
			fs.writeFileSync(backupFilePath, f);
		}
	}

	var writeRulesForFileToDisk = function(ruleTypeShort, ruleFile) {
		var rules;
		rules = cif.getRules(ruleTypeShort);

		// Filter rules to only contain rules from the target file.
		var filteredRules = rules.filter(function(rule) {
			return rule.origin === ruleFile;
		});

		console.log(filteredRules.length + " matching rules from this file");

		var preparedRulesObj = {};
		preparedRulesObj.fileName = ruleFile;
		preparedRulesObj.type = ruleTypeShort;
		preparedRulesObj.rules = filteredRules;
		// Convert to a string, using tabs to keep human readable.
		var serializedRules = JSON.stringify(preparedRulesObj, null, '\t');

		// Write the serialized rules to disk.
		var path = lastPath + "/" + ruleFile + ".json";
		if (fs !== undefined) {
			fs.writeFileSync(path, serializedRules);
		}
		console.log("writing to '" + path + "':");
	}

	// Create a JSON object representing every rule from the requested rules file. Serialize it. Backup the old version of the file. Write the new version to disk.
	// NOTE: must be defined before we call rulesEditor.init()
	var saveRules = function(ruleType, ruleFile, optOrigActiveFile) {
		console.log("saveRules(" + ruleType + ", " + ruleFile + ")");
		backupRulesFile(ruleFile);

		// TODO: rulesFile is in the form "triggerRules", but cif.getRules expects the form "trigger". Probably a way to refactor this so we don't need this kludge, & also to future-proof against additional kinds of rules.
		var ruleTypeShort;
		console.log("ruleType");
		if (ruleType === "triggerRules" || ruleType === "trigger") {
			ruleTypeShort = "trigger";
		} else {
			ruleTypeShort = "volition";
		}

		writeRulesForFileToDisk(ruleTypeShort, ruleFile);

		// If the active file changed, we need to update the old file, too (to delete the moved file).
		if (optOrigActiveFile !== undefined && optOrigActiveFile.trim() !== "" && optOrigActiveFile != ruleFile) {
			console.log("optOrigActiveFile is " + optOrigActiveFile + " and is different from ruleFile: " + ruleFile + ", so let's back it up too.")
			backupRulesFile(optOrigActiveFile);
			writeRulesForFileToDisk(ruleTypeShort, optOrigActiveFile);
		}
	}

	var loadSchema = function(schema) {
		// socialStructure = loadSampleData();
		socialStructure = cif.loadSocialStructure(schema);
		// Generate explanatory text.
		var exp = "";
		for (var className in socialStructure) {
			var d = cif.getClassDescriptors(className);
			var direction = d.directionType;
			var dataType = d.isBoolean ? "boolean" : "numeric";
			var duration = d.duration > 0 ? "duration " + d.duration : "";
			if (!d.isBoolean) {
				dataType += " " + d.min + "-->" + d.max + " (default " + d.defaultVal + ")";
			}
			if (d.duration === 0) {
				duration = "single turn";
			}
			exp += "<p class='schemaHeader'><span class='className'>" + className + "</span> <span class='classInfo'>" + direction + ", " + dataType + (duration !== "" ? ", " + duration : "") + "</span></p>";
			var c = socialStructure[className];
			exp += "<p class='schemaTypes'>";
			var types = [];
			for (var typeName in c) {
				types.push("<span class='schemaType'>" + typeName + "</span>");
			}
			var typeList = types.join(" &bull; ");
			exp += typeList + "<br/>"
		}
		$("#infoOnSocialTypes").html(exp);
	};

	var loadCast = function(cast) {
		// characters = cif.addCharacters(sampleChars);
		characters = cif.addCharacters(cast);

		// Generate labels
		var txt = "<ul>";
		for (var charPos in characters) {
			// Can be replaced with something more complex later when there's character metadata.
			// var charObj = sampleChars.characters[charKey];
			// txt += "<li><span class='charPrintedName'>" + charObj.name + "</span> <span class='charKey'>" + charKey + "</span>, Active</li>";
			txt += "<li>" + characters[charPos] + "</li>"
		}
		txt += "</ul>";
		$("#characterList").html(txt);

	};

	var loadHistory = function(content) {
		var history = content.history;
		for (var i = 0; i < history.length; i++) {
			// TODO add more error checking to look for out-of-order history steps, etc.
			var historyAtTime = history[i];
			cif.setupNextTimeStep(historyAtTime.pos);
			for (var j = 0; j < historyAtTime.data.length; j++) {
				var pred = historyAtTime.data[j];
				try {
					cif.set(pred);
				} catch(e) {
					console.log("invalid test sfdb file! double check this predicate:", pred);
				}
			}
		}
	};

	var loadRules = function(rules) {
		cif.addRules(rules);
		if (rules.type === "trigger") {
			ruleOriginsTrigger.push(rules.fileName);
			rulesViewer.show("trigger");
		}
		if (rules.type === "volition") {
			ruleOriginsVolition.push(rules.fileName);
			rulesViewer.show("volition");
		}
	};

	var fs;
	try {
		var fs = require('fs');
	} catch (e) {
		// If running in webbrowser, ignore.
	}

	var loadActions = function(actions){
		actionLibrary.parseActions(actions);
		var myActions = actionLibrary.getAllActions();
		// Generate labels
		var txt = "<ul>";
		for (var actionPos in myActions) {
		// Can be replaced with something more complex later
			txt += "<li>" + myActions[actionPos].name + "</li>";
		}
		txt += "</ul>";
		$("#actionList").html(txt);
	};

	var loadAllFilesFromFolder = function(folder) {
		return new Promise(function(resolve, reject) {
			var files, fileContents;
			try {
				fileContents = [];
				files = fs.readdirSync(folder);
				for (var i = 0; i < files.length; i++) {
					var filename = files[i];
					// Ignore files without a .json extension.
					var ext = filename.slice(filename.indexOf(".")+1,filename.length);
					if (ext.toLowerCase() !== "json") {
						console.log("Skipping '" + filename + "' because does not appear to have .json extension.");
						continue;	// i.e. next file
					}

					// Ignore files that don't appear to BE json.
					var content = JSON.parse(fs.readFileSync(folder + "/" + filename, 'utf-8'));

					content.source_file = filename;
					fileContents.push(content);
					console.log("Adding '"+filename+"'; fileContents now ", fileContents);
				}

				resolve(fileContents);
		    } catch(e) {
				reject(Error(e));
		    }

		});
	}


	var lastPath; // Store the last path we opened a file from, so we know where to save files back to.

	// Load a folder containing a set of schema files from disk into the editor and into CiF.
	var loadPackage = function() {
		var chooser = document.querySelector('#fileDialog');

		// The "change" event is triggered from the querySelector when the user has selected a file object (in this case, restricted to a folder by the "nwdirectory" flag in the #fileDialog item in cifconsole.html) and confirmed their selection by clicking OK.
		chooser.addEventListener("change", function(evt) {
			var schemaDir = this.value;
			lastPath = schemaDir;
			cif.reset();
			ruleOriginsTrigger = [];
			ruleOriginsVolition = [];
			historyViewer.reset();
			rulesViewer.show();

			// Need to make sure we load all files, then process them in the right order: schema first, then everything else. We'll use fancy new Javascript Promises to do this.
			// http://www.html5rocks.com/en/tutorials/es6/promises/		
			loadAllFilesFromFolder(schemaDir).then(function(files) {
				// "files" is now an array of objects, the parsed contents of the files. First find the schema definition.

				var schemaPos = -1;
				for (var i = 0; i < files.length; i++) {
					if (files[i].schema !== undefined) {
						if (schemaPos !== -1) {
							throw new Error("More than one schema file detected: files '" + files[schemaPos].source_file + "' and '" + files[i].source_file + "'. You can have only one file with a top level key of 'schema'.");
						}
						schemaPos = i;
					}
				}
				if (schemaPos >= 0) {
					console.log("loading schema: ", files[schemaPos].source_file);
					loadSchema(files[schemaPos]);
				} else {
					cmdLog("No schema file found.");
					return;
				}

				// Remove the schema file from the file list.
				files.splice(schemaPos, 1);

				// Now, process the rest of the files. The order here should not matter.
				for (var i = 0; i < files.length; i++) {
					var content = files[i];
					if (content.cast !== undefined) {
						loadCast(content);
					} else if (content.history !== undefined) {
						loadHistory(content)
					} else if (content.rules !== undefined) {
						try {
							loadRules(content);
						} catch(e) {
							cmdLog("Problem loading rules. " + e);
						}
					} else if (content.actions !== undefined) {
						loadActions(content);
					} else {
						cmdLog("Unrecognized file '" + content.source_file + "': should have found a top level key of 'schema', 'cast', 'history', 'actions', or 'rules'.");
					}
				}

				// Update the editor's rule origins.
				rulesEditor.init(rulesViewer, ruleOriginsTrigger, ruleOriginsVolition, saveRules);
				cmdLog("Schema loaded.", true);

			}, function(error) {
				cmdLog("Error " + error);
			});

		}, false);
		chooser.click();  

	};

	$("#msgBlock").click(function(){
		$(this).stop(true,true).fadeOut();
	});
	$("#newRule").click(function(){
		var type = $("#tabstrigger").is(":visible") ? "trigger" : "volition";

		var newRule = {};
		newRule.name = "New " + util.iCap(type) + " Rule";
		newRule.conditions = [];
		newRule.effects = [];
		
		var ruleWrapper = {};
		ruleWrapper.fileName = "__NEWRULE__";
		ruleWrapper.rules = [newRule];
		ruleWrapper.type = type;
		
		var newIds = cif.addRules(ruleWrapper);
		var newLoadedRule = cif.getRuleById(newIds[0]);
		rulesEditor.loadRule(newLoadedRule, type);
		$("#tabLiRulesEditor a").click();
	})

	cif.init();
	rulesViewer.init();

	console.log("cifconsole.js loaded.");
	if (autoLoad) {
		loadSchema(JSON.parse(sampleData));
		loadCast(JSON.parse(sampleChars));
		loadHistory(JSON.parse(testSfdbData));
		loadRules(JSON.parse(testTriggerRules));
		loadRules(JSON.parse(testVolitionRules));
		loadActions(JSON.parse(testActions));
		rulesEditor.init(rulesViewer, ruleOriginsTrigger, ruleOriginsVolition, saveRules);
		cmdLog("Autoloaded default schema.", true);
	}

	var storedVolitions;

	var runTriggerRules = function() {
		var triggerResults = cif.runTriggerRules(characters);
		var logMsg = "Running trigger rules:";
		for (var i = 0; i < triggerResults.explanations.length; i++) {
			var exp = triggerResults.explanations[i];
			logMsg += "<br/>" + exp;
		}
		return logMsg;
	}

	var runVolitionRules = function() {
		var logMsg = "Recalculating volitions.";
		storedVolitions = cif.calculateVolition(characters);
		return logMsg;
	}

	// Return a string uniquely identifying this date and time with minute accuracy, to be part of a filename timestamp, a la:
	// 14-03-26-1130
	var getDateTimeStamp = function() {
		var d = new Date();
		var stamp = (d.getFullYear() - 2000) + "-";
		var m = d.getMonth() + 1;
		stamp += (m < 10 ? ("0" + m) : m) + "-";
		var day = d.getDate();
		stamp += (day < 10 ? ("0" + day) : day) + "-";
		var h = d.getHours();
		stamp += (h < 10 ? ("0" + h) : h);
		var min = d.getMinutes();
		stamp += (min < 10 ? ("0" + min) : min);
		return stamp;
	}


	// CIF CONSOLE FUNCTIONS.
	var doNext = function() {
		cif.setupNextTimeStep();
		var curr = sfdb.getCurrentTimeStep();
		var logMsg = "CiF timestep advanced to " + curr + ".<br/>";

		// Run Trigger rules.
		logMsg += runTriggerRules() + "<br/>";

		// Run volition rules.
		logMsg += runVolitionRules();

		return cmdLog(logMsg, true);
	}

	var doShow = function(char) {
		var i, res, desc;
		var resultPrimary = cif.get({"first": char});
		var resultSecondary = cif.get({"second": char});
		console.log("results:", resultPrimary, resultSecondary);
		var logMsg = "<table><tr><td>";
		for (i = 0; i < resultPrimary.length; i++) {
			res = resultPrimary[i];
			desc = cif.getClassDescriptors(res.class)
			logMsg += cif.predicateToEnglish(res).text;
			if (desc.directionType === "reciprocal") {
				logMsg += " (R)";
			}
			if (res.duration !== undefined && res.duration > 0) {
				logMsg += " (expires in " + res.duration + " turns)";
			}
			logMsg += "<br/>";
		}
		if (resultPrimary.length === 0) {
			logMsg += "<i>No entries with this character as 'first'</i>";
		}
		logMsg += "</td></tr><tr><td>";
		for (i = 0; i < resultSecondary.length; i++) {
			res = resultSecondary[i];
			desc = cif.getClassDescriptors(res.class)
			if (desc.directionType === "reciprocal") {
				continue;
			}
			logMsg += cif.predicateToEnglish(res).text + "<br/>";
		}
		if (resultSecondary.length === 0) {
			logMsg += "<i>No entries with this character as 'second'</i>";
		}
		logMsg += "</td></tr></table>"
		return cmdLog(logMsg, true);
	}

	var doVolitions = function(char1, char2) {
		var i;
		var logMsg = "<table>";
		if (storedVolitions === undefined) {
			storedVolitions = cif.calculateVolition(characters);
		}
		var vol = storedVolitions.getFirst(char1, char2);
		while (vol !== undefined) {
			// Show the person's reasons for taking this action.
			logMsg += "<tr><td><span class='volitionType'>" + cif.predicateToEnglish(vol).text + "</span></td><td><span class='volitionExplanation'>Because:<br/>";
			for (i = 0; i < vol.englishInfluences.length; i++) {
				var inf = vol.englishInfluences[i];
				logMsg += "<span title='" + inf.englishRule + "'>" + inf.ruleName + " (" + inf.weight + ")</span><br/>";
			}

			// Show the responder's reasons for accepting or rejecting.
			logMsg += "</span></td><td><span class='volitionExplanation'><b>" + char2 + " would ";
			var acceptedObj = storedVolitions.isAccepted(char1, char2, vol);
			logMsg += acceptedObj.accepted ? "<span class='accepted'>accept</span>" : "<span class='rejected'>reject</span>";
			logMsg += " (" + acceptedObj.weight + ")</b>, because:<br/>";
			console.log("rw", acceptedObj, acceptedObj.reasonsWhy);
			if (acceptedObj.reasonsWhy.length > 0) {
				var reasons = acceptedObj.reasonsWhy[0].englishInfluences;
				for (i = 0; i < reasons.length; i++) {
					var reason = reasons[i];
					logMsg += "<span title='" + reason.englishRule + "'>" + reason.ruleName + " (" + reason.weight + ")</span><br/>";
				}
			} else {
				logMsg += "<i>default (no matching rules)</i>"
			}
			logMsg += "</td></tr>"

			// Retrieve the next volition and continue the while loop if it's not undefined.
			vol = storedVolitions.getNext(char1, char2);
		}
		logMsg += "</table>"
		return cmdLog(logMsg);
	}

	var doActions = function(char1, char2){
		console.log("Doing actions for " + char1 + " and " + char2);
		var i; 
		var logMsg = "<table>";
		if (storedVolitions === undefined) {
			storedVolitions = cif.calculateVolition(characters);
		}
		var vol = storedVolitions.getFirst(char1, char2);
		while (vol !== undefined){
			console.log("this is what vol is: " , vol);
			var possibleActionsForThisVolition = actionLibrary.getActionsFromVolition(vol);
			for(var i = 0; i < possibleActionsForThisVolition.length; i +=1){

				logMsg += "<tr><td><span class='actionType'> [" + i + "] " + char1 + " wants to " + possibleActionsForThisVolition[i].name + " with " + char2 + " (" + vol.weight + ") </span></td>";
			}

			// Show the responder's reasons for accepting or rejecting the action.
			logMsg += "</span></td><td><span class='volitionExplanation'><b>" + char2 + " would ";
			var acceptedObj = storedVolitions.isAccepted(char1, char2, vol);
			logMsg += acceptedObj.accepted ? "<span class='accepted'>accept</span>" : "<span class='rejected'>reject</span>";
			logMsg += " (" + acceptedObj.weight + ")</b>, because:<br/>";
			console.log("rw", acceptedObj, acceptedObj.reasonsWhy);
			if (acceptedObj.reasonsWhy.length > 0) {
				var reasons = acceptedObj.reasonsWhy[0].englishInfluences;
				for (i = 0; i < reasons.length; i++) {
					var reason = reasons[i];
					logMsg += "<span title='" + reason.englishRule + "'>" + reason.ruleName + " (" + reason.weight + ")</span><br/>";
				}
			} else {
				logMsg += "<i>default (no matching rules)</i>"
			}


			// Retrieve the next volition and continue the while loop if it's not undefined.
			logMsg += "</tr>";
			vol = storedVolitions.getNext(char1, char2);
		}

		logMsg += "</table>";
		console.log("logMsg: " + logMsg);
		return cmdLog(logMsg);
	};

	var doDoAction = function(char1, char2, action, isAccepted){
		//Print out some nice things to the console letting the user know what action is taking place
		cmdLog("<b>" + char1 + "</b> is doing action <b>" + action.name + "</b> with <b>" +char2+ "</b> accepted: <b>" + isAccepted + "</b>", true);
		cmdLog("<b> CHANGED SOCIAL STATE: </b><BR>-----------------", true);
	
		//Right now the action is unbounded; we should do the binding!
		//(i.e. fill in the 'roles' of the effect with actual character names)
		action = actionLibrary.bindActionEffects(char1, char2, action);

		//Let's grab the appropriate set of effects.
		var effects;
		if(isAccepted){
			effects = action.acceptEffects;
		}
		else{
			effects = action.rejectEffects;
		}

		for(var i = 0; i < effects.length; i += 1){
			//Get information based on the class of the effect (such as the direction)
			var className = effects[i].class;
			var d = cif.getClassDescriptors(className);
			var directionType = d.directionType;

			//Helper string; if the value of the effect is false, say that the character does NOT have this state anymore.
			var notString;
			notString = "is now";
			if(effects[i].value === false){
				notString = "is no longer";
			}

			//Tack on a helpful note at the end of the console message if 
			//the 'effect' we are setting isn't actually a change from the current social state.
			var origValue = cif.get(effects[i]);
			var alreadyTrue = origValue.length > 0;
			var alreadyTrueString = "";
			if(alreadyTrue){
				alreadyTrueString = "(FYI, this was already true)";
			}

			//Actually update the sfdb!
			cif.set(effects[i]);

			//Print out a message to the console letting the user know what changed.
			if(directionType === "undirected"){
				//only involves one person
				cmdLog("<b>" + effects[i].first + "</b> " + notString + " <b>" + effects[i].type + "</b> " + alreadyTrueString, true);
			}
			else if(directionType === "directed" || directionType === "reciprocal"){
				// it is directed or recipricol; involves two people
				cmdLog("<b>" + effects[i].first + "</b> " + notString + " <b>" + effects[i].type + "</b> <b>" +effects[i].second + "</b> " + alreadyTrueString, true);
			}
		}

		cmdLog("-----------------", true);

		//And now I guess I want to run the trigger rules?
		logMsg = runTriggerRules() + "<br/>" + runVolitionRules();
		cmdLog(logMsg, true);
	};


	// Take a raw string and process it as a command.
	var processCommand = function(cmd) {

		var params;

		if (socialStructure === undefined) {
			return cmdLog("No social structure loaded.");
		}
		if (characters === undefined) {
			return cmdLog("No characters loaded.");
		}

		// Utility function "extract": returns an array of ordered matched items, removing them from the "params" array. Crash with an explanatory message if the wrong number of matches is found.
		var extract = function(matchList, desc, min, max) {
			var pos = 0;
			var found = [];
			while (pos < params.length) {
				if (matchList.indexOf(params[pos]) >= 0) {
					found.push(params[pos]);
					params.splice(pos, 1);
				} else {
					pos += 1;
				}
			}
			if (found.length < min || found.length > max) {
				var msg = "found " + found.length + " " + desc + " references (" + found.join(", ") + ") but expected ";
				if (min === max) {
					msg += min + ".";
				} else {
					msg += "between " + min + " and " + max + ".";
				}
				cmdLog(msg);				
				return false;
			}
			return found;
		}

		// BEGIN processCommand

		// Echo the command typed to the console.
		cmdLog("&gt; <b>" + cmd + "</b>", true);

		// var networks = _.keys(this.props.networks);
		// var relationships = _.keys(this.props.relationships);
		// var characters = _.keys(this.props.characters);
		var value = true;
		var chars;
		var res;
		var logMsg;
		var i;

		// Get the command and its parameters.
		cmd = cmd.toLowerCase();
		params = cmd.split(/[(),;]/g);
		params = params.map(function(x){ return x.trim() });

		var command = params.shift();
		params = _.without(params, "");

		// Process each possible command.
		if (command === "next") {	
			return doNext();
		}

		if (command === "dump") {
			console.log(sfdb.dumpSFDB());
			return;
		}

		if (command === "show") {
			chars = extract(characters, "characters", 1, 1);
			if (!chars) return;
			return doShow(chars[0]);
		}

		if (command === "volitions") {
			chars = extract(characters, "characters", 1, 2);
			if (chars.length === 1) {
				// Run for every other character.
				for (var j = 0; j < characters.length; j++) {
					if (characters[j] === chars[0]) continue;
					processCommand("volitions(" + chars[0] + "," + characters[j] + ")"); 
				}
				return;
			}
			if (!chars) return;
			return doVolitions(chars[0], chars[1]);
		}

		if (command === "actions") {
			chars = extract(characters, "characters", 1, 2);
			if(chars.length === 1){
				//run for every other character.
				for (var j = 0; j < characters.length; j++){
					if (characters[j] === chars[0]) continue;
					processCommand("actions(" + chars[0] + "," + characters[j] + ")");
				}
				return;
			}
			if (!chars) return;
			return doActions(chars[0], chars[1]);
			/*
			chars = extract(characters, "characters", 1, 2);
			if (chars.length === 1) {
				// Run for every other character.
				for (var j = 0; j < characters.length; j++) {
					if (characters[j] === chars[0]) continue;
					processCommand("volitions(" + chars[0] + "," + characters[j] + ")"); 
				}
				return;
			}
			if (!chars) return;
			return doVolitions(chars[0], chars[1]);
			*/
		}

		if (command === "doaction"){

			//Grab the characters from the string.
			chars = extract(characters, "characters", 2, 2);
			if (!chars) return;
			var char1 = chars[0];
			var char2 = chars[1];

			// Reject commands with the same character multiple times.
			if (chars.length === 2 && chars[0] === chars[1]) {
				return cmdLog("Can't reference the same character twice.");
			}

			//Get the list of all possible action names that exist.
			var actionNames = [];
			var actions = actionLibrary.getActions();
			for(var i = 0; i < actions.length; i+= 1){
				actionNames.push(actions[i].name.toLowerCase());
			}

			//allCandidates will be used by 'extract' to make sure that they typed a valid action reference
			//The action reference can either be the 'name' of an action, or a 'number' (which can be seen
			//by using the 'actions' command in the interface)
			var allCandidates = util.clone(actionNames);


			//At this point, we know what action the user specified; but now we have to check 
			//if the character WANTS to do that action in the first place.
			if (storedVolitions === undefined) {
				storedVolitions = cif.calculateVolition(characters);
			}

			var vol = storedVolitions.getFirst(char1, char2);
			var acceptableActions = []; // actions the character actually wants to take
			var acceptableIndexes = []; // indeces that map to actions the character actually wants to take.
			var actionList = []; // Actual action object (stored in the same index as the previous two arrays)
			var currentActionIndex = 0; //Just a counter, used to track "good' action indexes."
			var desiredAction = undefined;
			var foundDesiredAction = false;
			var acceptedArray = [];
			var isAccepted;
			while (vol !== undefined){
				var possibleActionsForThisVolition = actionLibrary.getActionsFromVolition(vol);
				for(var i = 0; i < possibleActionsForThisVolition.length; i +=1){
					//Each volition might have multiple actions attached to it.
					//This is us testing that! The only "acceptable" actions are actions that should show up
					//in this list!
					acceptableActions.push(possibleActionsForThisVolition[i].name.toLowerCase());
					acceptableIndexes.push(currentActionIndex.toString());
					actionList.push(possibleActionsForThisVolition[i]);
					allCandidates.push(currentActionIndex.toString());
					if(storedVolitions.isAccepted(char1, char2, possibleActionsForThisVolition[i].intent)){
						acceptedArray.push(true);
					}
					else{
						acceptedArray.push(false);
					}
					currentActionIndex += 1;
				}
				// Retrieve the next volition and continue the while loop if it's not undefined.
				vol = storedVolitions.getNext(char1, char2);
			}

			//So, this will catch two things:
			//1.) If they typed in a nonsense action that doesn't exist
			//2.) They typed in an 'action number' that is invalid (i.e. bigger than the numuber of actions the 
			//characters had volitions for.)
			var actionMatch = extract(allCandidates, "recognized action", 1, 1);
			if (!actionMatch){
				return;
			} 
			var actionSearch = actionMatch[0];

			//So, at this point, we still don't actually quite know if they typed in 
			//an action name or an action number. However, we do know the list of all
			//acceptable names and numbers. Check to see if what they typed IS acceptable!
			var nameIndex = $.inArray(actionSearch, acceptableActions);
			if( nameIndex !== -1){
				//console.log(" found it in the action names!");
				foundDesiredAction = true;
				desiredAction = actionList[nameIndex];
				isAccepted = acceptedArray[nameIndex];
			}
			var indexIndex = $.inArray(actionSearch, acceptableIndexes);
			if( indexIndex !== -1){
				//console.log("found it in the index list!");
				foundDesiredAction = true;
				desiredAction = actionList[indexIndex];
				isAccepted = acceptedArray[indexIndex];
			}

			//Print out an error message if they typed in an action name that characters don't have volition to perform.
			if(foundDesiredAction){
				;//console.log("You wanted to " + desiredAction.name + " and the characters wanted to do that too!")
			}
			else{
				return cmdLog(char1 + " does not have sufficient volition to " + actionSearch + " " + char2);
			}

			//And now we can actually hope to do the action!
			return doDoAction(char1, char2, desiredAction, isAccepted);
		}

		if (command === "unset") {
			value = false;
			command = "set";
		}

		if (command === "set") {

			// Look for one or two characters. Preserve the order.
			chars = extract(characters, "characters", 1, 2);
			if (!chars) return;

			// Reject commands with the same character multiple times.
			if (chars.length === 2 && chars[0] === chars[1]) {
				return cmdLog("Can't reference the same character twice.");
			}

			// Look for a type word and determine its class.
			var allTypes = [];
			for (var className in socialStructure) {
				var c = socialStructure[className];
				for (var type in c) {
					allTypes.push(type);
				}
			}

			var typeMatch = extract(allTypes, "recognized social type", 1, 1);
			if (!typeMatch) return;
			var type = typeMatch[0];
			var className = cif.getClassFromType(type);
			if (!className) {
				return cmdLog("Did not recognize '" + type + "' as a registered type within a social scheme.");
			}
			var classDetails = cif.getClassDescriptors(className);

			// If undirected, we should have found one character.
			if (classDetails.directionType === "undirected") {
				if (chars.length !== 1) {
					return cmdLog("Included more than one character, but " + className + " '" + type + "' is undirected.");
				}
			} else {
				// Otherwise, is directed or reciprocal; requires two characters.
				if (chars.length !== 2) {
					return cmdLog("Included only one character, but " + className + " '" + type + "' is " + classDetails.directionType + " and requires two.");
				}
			}

			// Look for booleans.
			var pos = 0;
			var bools = [];
			while (pos < params.length) {
				if (params[pos] === "true" || params[pos] === "false") {
					bools.push(params[pos] === "true" ? true : false);
					params.splice(pos, 1);
				} else {
					pos += 1;
				}
			}
			if (bools.length > 1) {
				return cmdLog("Found multiple booleans: " + bools.join(", ") + ". Only one boolean at a time is valid.");
			}
			if (bools.length === 1 && bools[0] === "false") {
				value = false;
			}

			// Look for numbers.
			var pos = 0;
			var numbers = [];
			while (pos < params.length) {
				var x = parseInt(params[pos]);
				if (!isNaN(x)) {
					numbers.push(x);
					params.splice(pos, 1);
				} else {
					pos += 1;
				}
			}
			if (numbers.length > 1) {
				return cmdLog("Found multiple numbers: " + numbers.join(", ") + ". Only one number at a time is valid.");
			}

			// Make sure the types we found are as expected.
			if (classDetails.isBoolean && numbers.length > 0) {
				return cmdLog("Oops: " + className + " '" + type + "' is boolean, so a number is not valid here.");
			}
			if (!classDetails.isBoolean && bools.length > 0) {
				return cmdLog("Oops: " + className + " '" + type + "' is numeric, so a boolean is not valid here.");
			}

			// We should now have accounted for all params. Otherwise, we have too many.
			if (params.length > 0) {
				return cmdLog("Did not recognize extra params: " + params.join(", "));
			}

			if (numbers.length > 0) {
				value = numbers[0];
			}
			if (bools.length > 0) {
				value = bools[0];
			}

			var pred = {
				"class": className,
				"type": type,
				"first": chars[0],
				"value": value
			};
			if (chars.length == 2) {
				pred.second = chars[1];
			}
			if (typeof value === "number") {
				pred.operator = "=";
			}
			var origValue = cif.get(pred);
			var alreadyTrue = origValue.length > 0;
			var result = cif.set(pred);
			if (alreadyTrue) {
				cmdLog("<span title='" + util.objToText(origValue[0]) + "'>OK; but this was already the case (hover for matching predicate).</span>", true)
			} else {
				cmdLog("OK.", true);			
			}
			
			logMsg = runTriggerRules() + "<br/>" + runVolitionRules();
			cmdLog(logMsg, true);
			ruleTester.update();
			return result;
		} else {
			cmdLog("Not a valid command.");
		}
	};

	var consoleHistory = [];
	var historyPos = -1;
	
	var keyPress = function(e) {
		var raw = document.getElementById("command").value;
		var keyPressed = e.which;

		// If key pressed was enter, process.
		if (keyPressed === 38) { // up arrow
			if (historyPos >= 0) {
				$("#command").val(consoleHistory[historyPos]);
				if (historyPos > 0) historyPos--;
			}
		} else if (keyPressed === 40) { // down arrow
			if (historyPos >= 0 && historyPos < consoleHistory.length) {
				$("#command").val(consoleHistory[historyPos]);
				if (historyPos < consoleHistory.length) historyPos++;
			}
		}
		if (keyPressed === 13) {	// ASCII 'enter'
			processCommand(raw);
			$("#command").val("");
			consoleHistory.push(raw);
			historyPos = consoleHistory.length - 1;
		}
	};

	var ruleFilterKey = function(e) {
		var raw = document.getElementById("inputRuleFilter").value;
		rulesViewer.filterWithout("tabstrigger", raw);
		rulesViewer.filterWithout("tabsvolition", raw);
	}

	// Set up console
	document.getElementById("command").onkeyup = keyPress;
	document.getElementById("command").onchange = keyPress;


	document.getElementById("inputRuleFilter").onkeyup = ruleFilterKey;
	document.getElementById("inputRuleFilter").onchange = ruleFilterKey;



});