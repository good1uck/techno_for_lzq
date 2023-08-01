console.clear();
var start = function() {
	var AudioContext = window.AudioContext || window.webkitAudioContext;
	var context = new AudioContext();
	var bpm = 125.0;
	var barsToSeconds = function(bars) {
		return bars * 240.0 / bpm;
	};
	var secondsToBars = function(seconds) {
		return seconds * bpm / 240.0;
	};
	var noteToFrequency = function(midiNote) {
		return 440.0 * Math.pow(2.0, (midiNote + 3.0) / 12.0 - 6.0);
	};

	var random = (function() {
		var seed = 0xABCDEF;
		return function() {
			return (seed = (seed * 16807) % 2147483647) / 2147483647.0;
		};
	})();

	var delay = function(delayTime, delayFeedback, wet, dry) {
		var input = context.createGain();
		var output = context.createGain();
		var dryGain = context.createGain();
		var wetGain = context.createGain();
		var delay = context.createDelay();
		var feedback = context.createGain();
		delay.delayTime.value = delayTime;
		feedback.gain.value = delayFeedback;
		dryGain.gain.value = dry;
		wetGain.gain.value = wet;
		input.connect(dryGain);
		input.connect(wetGain);
		dryGain.connect(output);
		wetGain.connect(delay);
		delay.connect(feedback);
		feedback.connect(delay);
		delay.connect(output);
		return {
			input: input,
			output: output
		};
	};

	var convolver = function(gain) {
		var convolver = context.createConvolver();
		var convolverGain = context.createGain();
		convolverGain.gain.value = gain;
		convolver.connect(convolverGain);
		return {
			input: convolver,
			output: convolverGain,
			loadImpulse: function(url, success) {
				var request = new XMLHttpRequest();
				request.open("GET", url, true);
				request.responseType = "arraybuffer";
				request.onload = function() {
					context.decodeAudioData(request.response, function(buffer) {
						convolver.buffer = buffer;
						if (success) success();
					}, function(e) {
						console.error(e);
					});
				};
				request.onerror = function(e) {
					console.error(e);
				};
				request.send();
			}
		};
	};

	var buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
	var data = buffer.getChannelData(0);
	for (var i = 0; i < data.length; ++i) {
		data[i] = random() * 2.0 - 1.0;
	}

	var room = convolver(0.5);
	room.loadImpulse( "https://s3-us-west-2.amazonaws.com/s.cdpn.io/131247/factory.hall.ogg" );
	room.output.connect(context.destination);
	var delayA = delay(barsToSeconds(7.0 / 16.0), 0.3, 0.4, 1.0);
	var delayB = delay(barsToSeconds(3.0 / 16.0), 0.4, 0.2, 1.0);

	var synthGain = context.createGain();
	synthGain.gain.value = 0.15;
	var synthPanning = context.createStereoPanner();
	synthGain.connect(synthPanning);
	synthPanning.connect(delayA.input);
	delayA.output.connect(delayB.input);
	delayB.output.connect(context.destination);
	delayB.output.connect(room.input);

	var kick = function(time) {
		var osc = context.createOscillator();
		var env = context.createGain();
		osc.connect(env);
		env.connect(context.destination);
		osc.frequency.value = 120;
		osc.frequency.setValueAtTime(120, time);
		osc.frequency.exponentialRampToValueAtTime(50, time + 0.1);
		env.gain.value = 0.8;
		env.gain.setValueAtTime(0.8, time);
		env.gain.linearRampToValueAtTime(0.0, time + 0.2);
		osc.start(time);
		osc.stop(time + 0.2);
	};

	function closedHat(position, volume) {
		var hat = context.createBufferSource();
		hat.buffer = buffer;
		hat.start(position);
		hat.stop(position + 0.02);
		var flt = context.createBiquadFilter();
		flt.type = "highpass";
		flt.frequency.value = 9000;
		hat.connect(flt);
		var gain = context.createGain();
		gain.gain.value = volume;
		flt.connect(gain);
		gain.connect(context.destination);
	}

	var playSynth = function(position, duration, freqBegin, freqEnd, stereo, notes) {
		var q = 0.5;
		var complete = position + duration;
		var merger = context.createChannelMerger();
		var fltA, fltB, fltC;
		fltA = context.createBiquadFilter();
		fltA.type = "lowpass";
		fltA.Q.value = q;
		fltA.frequency.setValueAtTime(freqBegin, position);
		fltA.frequency.exponentialRampToValueAtTime(freqEnd, complete);
		fltB = context.createBiquadFilter();
		fltB.type = "lowpass";
		fltB.Q.value = q;
		fltB.frequency.setValueAtTime(freqBegin, position);
		fltB.frequency.exponentialRampToValueAtTime(freqEnd, complete);
		fltC = context.createBiquadFilter();
		fltC.type = "lowpass";
		fltC.Q.value = q;
		fltC.frequency.setValueAtTime(freqBegin, position);
		fltC.frequency.exponentialRampToValueAtTime(freqEnd, complete);
		var n = notes.length;
		for (var i = 0; i < n; ++i) {
			var frequency = noteToFrequency(notes[i]);
			var oscA = context.createOscillator();
			oscA.type = 'square';
			oscA.frequency.value = frequency + stereo;
			oscA.start(position);
			oscA.stop(complete);
			oscA.connect(merger, 0, 0);
			var oscB = context.createOscillator();
			oscB.type = 'square';
			oscB.frequency.value = frequency - stereo;
			oscB.start(position);
			oscB.stop(complete);
			oscB.connect(merger, 0, 1);
		}
		merger.connect(fltA);
		fltA.connect(fltB);
		fltB.connect(fltC);
		fltC.connect(synthGain);
	}

	var bars = 0.0;
	var nextSchedule = context.currentTime;
	var scheduleTime = 0.050;
	var aheadTime = 0.100;
	var intervalMs = 10.0;
	var semiquaver = 1.0 / 16.0;
	var chordA = [36, 39, 43];
	var chordB = [38, 41, 46];
	var chordC = [39, 42, 46];
	var p = document.querySelector("p");

	var schedule = function() {
		var now = context.currentTime;
		if (now + aheadTime > nextSchedule) {
			var target = bars + secondsToBars(scheduleTime);
			var index = Math.floor(bars / semiquaver);
			var position = index * semiquaver;
			while (position < target) {
				if (position >= bars) {
					{ // time display
						p.textContent = ("000" + (Math.floor(bars) + 1)).substr(-3) + "." +
							(Math.floor(bars * 4) % 4 + 1) + ":" +
							(Math.floor(bars * 16) % 4 + 1);
					}
					var startTime = nextSchedule + barsToSeconds(position - bars);
					var semiquaverTime = barsToSeconds(semiquaver);
					var mod4 = index % 4;
					var mod32 = index % 32;
					var mod128 = index % 128;
					if (0 == mod4) {
						kick(startTime);
					}
					if (0 < mod4) {
						closedHat(startTime, Math.pow(Math.sin(mod4 / 4.0 * Math.PI), 10.0) * 0.5);
					}
					if (4 == mod32) {
						playSynth(startTime, semiquaverTime * 2.0,
							3000 - Math.cos(position / 24 * Math.PI * 2.0) * 1000.0, 240, 0.1, chordA);
					}
					if (30 == mod32) {
						playSynth(startTime, semiquaverTime * 2.0,
							3000 - Math.cos(position / 28 * Math.PI * 2.0) * 2000.0, 240, 0.2, chordC);
					}
					if (123 == mod128) {
						playSynth(startTime, semiquaverTime * 4.0, 240, 660, -0.07, chordC);
					}
					synthPanning.pan.linearRampToValueAtTime(Math.sin((index % 7) / 7.0 * Math.PI * 2.0) * 0.5, startTime);
				}
				position = ++index * semiquaver;
			}
			bars = target;
			nextSchedule = nextSchedule + scheduleTime;
		}
	};
	setInterval(schedule, intervalMs);
};

window.addEventListener("click", function() {
	console.log("start");
	start();
	window.removeEventListener("click", arguments.callee);
});