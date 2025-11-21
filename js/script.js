/* DAW FX RACK - REMASTERED LOGIC 
   Fixed: Download Functionality, Mobile Support, Animation
*/

const EFFECTS_CONFIG = {
    eq: { 
        id: 'eq', name: 'Parametric EQ', icon: 'fa-solid fa-sliders', 
        params: { 
            highGain: { name: 'High', type: 'v-slider', min: -24, max: 24, value: 0, step: 0.1, unit: 'dB' }, 
            midGain:  { name: 'Mid',  type: 'v-slider', min: -24, max: 24, value: 0, step: 0.1, unit: 'dB' },
            lowGain:  { name: 'Low',  type: 'v-slider', min: -24, max: 24, value: 0, step: 0.1, unit: 'dB' }
        } 
    },
    compressor: { 
        id: 'compressor', name: 'Compressor', icon: 'fa-solid fa-compress', 
        params: { 
            threshold: { name: 'Thresh', type: 'v-slider', min: -60, max: 0, value: -24, step: 1, unit: 'dB' }, 
            ratio:     { name: 'Ratio',  type: 'v-slider', min: 1, max: 20, value: 4, step: 0.1, unit: ':1' }, 
            attack:    { name: 'Atk',    type: 'h-slider', min: 0, max: 1, value: 0.003, step: 0.001, unit: 's' }, 
            release:   { name: 'Rel',    type: 'h-slider', min: 0.01, max: 1, value: 0.25, step: 0.001, unit: 's' } 
        } 
    },
    delay: { 
        id: 'delay', name: 'Stereo Delay', icon: 'fa-solid fa-stopwatch', 
        params: { 
            time:     { name: 'Time',   type: 'h-slider', min: 0.01, max: 1.0, value: 0.3, step: 0.01, unit: 's' }, 
            feedback: { name: 'F.Back', type: 'h-slider', min: 0, max: 0.9, value: 0.4, step: 0.01, unit: '%' }, 
            mix:      { name: 'Mix',    type: 'h-slider', min: 0, max: 1, value: 0.4, step: 0.01, unit: '%' } 
        } 
    },
    reverb: { 
        id: 'reverb', name: 'Reverb', icon: 'fa-solid fa-water', 
        params: { 
            decay: { name: 'Decay', type: 'h-slider', min: 0.5, max: 5, value: 2, step: 0.1, unit: 's' },
            mix:   { name: 'Mix',   type: 'h-slider', min: 0, max: 1, value: 0.3, step: 0.01, unit: '%' }
        } 
    }
};

class DAWApp {
    constructor() {
        this.dom = {};
        this.audio = { ctx: null, nodes: {}, masterGain: null, analyser: null };
        this.state = {
            isPlaying: false, fileLoaded: false, audioBuffer: null,
            startTime: 0, startOffset: 0,
            fxChainOrder: JSON.parse(localStorage.getItem('fxChainOrder')) || ['eq', 'compressor', 'delay', 'reverb'],
            fxParams: {},
            masterPeak: 0, lastPeakTime: 0
        };
        this.visualizers = {};
    }

    init() {
        this.cacheDOM();
        this.initState();
        this.initAudioContext();
        this.initUI();
        this.initEventListeners();
        this.renderFXChain();
        this.loop();
    }

    cacheDOM() {
        const $ = (s) => document.querySelector(s);
        this.dom = {
            fileInput: $('#file-input'), uploadBtn: $('#upload-trigger-btn'),
            fileName: $('#file-name'), playBtn: $('#play-pause-btn'), playIcon: $('#play-pause-btn i'),
            downloadBtn: $('#download-btn'),
            waveformContainer: $('#waveform-container'), waveformCanvas: $('#waveform-canvas'), progressCanvas: $('#progress-overlay'), playhead: $('#playhead'),
            currentTime: $('#current-time'), totalDuration: $('#total-duration'),
            spectrogramCanvas: $('#spectrogram-canvas'), oscilloscopeCanvas: $('#oscilloscope-canvas'),
            fxChainContainer: $('#fx-chain-container'), moduleTemplate: $('#fx-module-template'),
            themeSelector: $('#theme-selector'),
            masterMeterBar: $('#master-meter-bar'), masterPeak: $('#master-peak-indicator'), masterReadout: $('#master-db-readout'),
            emptyMsg: $('#empty-chain-msg'), toastContainer: $('#toast-container'),
            resetBtn: $('#global-reset-btn')
        };
    }

    initState() {
        const savedTheme = localStorage.getItem('theme') || 'theme-dark';
        document.documentElement.className = savedTheme;
        this.dom.themeSelector.value = savedTheme;

        this.state.fxChainOrder = this.state.fxChainOrder.filter(id => EFFECTS_CONFIG[id]);
        for (const fxId of this.state.fxChainOrder) {
            this.state.fxParams[fxId] = { bypass: false };
            if (EFFECTS_CONFIG[fxId]) {
                for (const paramId in EFFECTS_CONFIG[fxId].params) {
                    this.state.fxParams[fxId][paramId] = EFFECTS_CONFIG[fxId].params[paramId].value;
                }
            }
        }
    }

    initAudioContext() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audio.ctx = new AudioContext();
        this.audio.masterGain = this.audio.ctx.createGain();
        this.audio.analyser = this.audio.ctx.createAnalyser();
        this.audio.analyser.fftSize = 2048; 
        this.audio.masterGain.connect(this.audio.analyser);
        this.audio.analyser.connect(this.audio.ctx.destination);
        this.audio.meterData = new Float32Array(this.audio.analyser.fftSize);
        
        // Default Reverb Impulse
        this.reverbBuffer = this.createImpulseResponse(this.audio.ctx, 2.0, 2.0);
        this.createFXNodes(this.audio.ctx, this.audio.nodes);
    }

    createFXNodes(ctx, targetNodeStorage) {
        for (const fxId in EFFECTS_CONFIG) {
            const input = ctx.createGain();
            const output = ctx.createGain();
            const group = { input, output, nodes: {} };
            
            switch(fxId) {
                case 'eq':
                    group.nodes.low = ctx.createBiquadFilter();
                    group.nodes.low.type = 'lowshelf'; group.nodes.low.frequency.value = 320;
                    group.nodes.mid = ctx.createBiquadFilter(); group.nodes.mid.type = 'peaking'; group.nodes.mid.frequency.value = 1000;
                    group.nodes.high = ctx.createBiquadFilter();
                    group.nodes.high.type = 'highshelf'; group.nodes.high.frequency.value = 3200;
                    input.connect(group.nodes.low).connect(group.nodes.mid).connect(group.nodes.high).connect(output);
                    break;
                case 'compressor':
                    group.nodes.comp = ctx.createDynamicsCompressor();
                    input.connect(group.nodes.comp).connect(output); 
                    break;
                case 'delay':
                    group.nodes.delay = ctx.createDelay(2.0);
                    group.nodes.feedback = ctx.createGain(); 
                    group.nodes.wet = ctx.createGain(); group.nodes.dry = ctx.createGain();
                    input.connect(group.nodes.dry).connect(output);
                    input.connect(group.nodes.delay); 
                    group.nodes.delay.connect(group.nodes.feedback).connect(group.nodes.delay); 
                    group.nodes.delay.connect(group.nodes.wet).connect(output);
                    break;
                case 'reverb':
                    group.nodes.conv = ctx.createConvolver();
                    // Gunakan buffer reverb yang sudah ada jika di main context, atau null dulu
                    if(ctx === this.audio.ctx) group.nodes.conv.buffer = this.reverbBuffer;
                    group.nodes.dry = ctx.createGain(); group.nodes.wet = ctx.createGain();
                    input.connect(group.nodes.dry).connect(output); 
                    input.connect(group.nodes.conv).connect(group.nodes.wet).connect(output);
                    break;
            }
            targetNodeStorage[fxId] = group;
        }
    }

    initUI() {
        this.visualizers.waveform = new Waveform(this.dom.waveformCanvas, this.dom.progressCanvas);
        this.visualizers.spectrogram = new Spectrogram(this.dom.spectrogramCanvas, this.audio.analyser);
        this.visualizers.oscilloscope = new Oscilloscope(this.dom.oscilloscopeCanvas, this.audio.analyser);
    }

    initEventListeners() {
        this.dom.uploadBtn.addEventListener('click', () => this.dom.fileInput.click());
        this.dom.fileInput.addEventListener('change', this.handleFileLoad.bind(this));
        this.dom.downloadBtn.addEventListener('click', this.handleDownload.bind(this));
        
        this.dom.playBtn.addEventListener('click', async () => {
            if(this.audio.ctx.state === 'suspended') await this.audio.ctx.resume();
            this.state.isPlaying ? this.pause() : this.play();
        });
        
        this.dom.themeSelector.addEventListener('change', (e) => {
            document.documentElement.className = e.target.value;
            localStorage.setItem('theme', e.target.value);
        });
        
        this.dom.resetBtn.addEventListener('click', this.handleGlobalReset.bind(this));
        
        // Drag and Drop
        this.dom.fxChainContainer.addEventListener('dragstart', e => {
            e.target.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        this.dom.fxChainContainer.addEventListener('dragend', e => {
            e.target.classList.remove('dragging');
            this.updateChainOrder();
        });
        this.dom.fxChainContainer.addEventListener('dragover', e => {
            e.preventDefault();
            const dragging = document.querySelector('.dragging');
            const afterElement = getDragAfterElement(this.dom.fxChainContainer, e.clientX);
            if(afterElement == null) { this.dom.fxChainContainer.appendChild(dragging); } 
            else { this.dom.fxChainContainer.insertBefore(dragging, afterElement); }
        });
        
        this.dom.waveformContainer.addEventListener('click', e => {
            if(!this.state.fileLoaded) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            this.state.startOffset = pct * this.state.audioBuffer.duration;
            if(this.state.isPlaying) { this.pause(); this.play(); } else { this.updatePlayhead(pct); }
        });
    }

    handleGlobalReset() {
        if(!confirm("Reset semua efek ke pengaturan awal?")) return;
        for (const fxId of this.state.fxChainOrder) {
            if (EFFECTS_CONFIG[fxId]) {
                this.state.fxParams[fxId].bypass = false;
                for (const paramId in EFFECTS_CONFIG[fxId].params) {
                    this.state.fxParams[fxId][paramId] = EFFECTS_CONFIG[fxId].params[paramId].value;
                }
            }
        }
        this.renderFXChain();
        this.showToast("Semua efek di-reset", "info");
    }

    /* --- FIXED DOWNLOAD FUNCTION --- */
    async handleDownload() {
        if (!this.state.audioBuffer) return;

        // 1. UI Feedback & Animation
        const btn = this.dom.downloadBtn;
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Rendering...';
        btn.classList.add('btn-download-anim'); // Add pulse animation
        btn.disabled = true;

        try {
            // 2. Setup Offline Context
            // Gunakan sample rate yang sama dengan buffer asli untuk menghindari resampling artifact
            const offlineCtx = new OfflineAudioContext(
                this.state.audioBuffer.numberOfChannels,
                this.state.audioBuffer.length,
                this.state.audioBuffer.sampleRate
            );

            // 3. Re-create FX Nodes in Offline Context
            const offlineNodes = {};
            this.createFXNodes(offlineCtx, offlineNodes);
            
            // 4. Apply Current Parameters to Offline Nodes
            // Kita harus manual set value karena automation tidak otomatis tercopy
            for(const fxId in this.state.fxParams) {
                const params = this.state.fxParams[fxId];
                const group = offlineNodes[fxId];
                
                // Bypass logic
                if(params.bypass) {
                    group.input.gain.value = 0; 
                    // Bypass means input goes nowhere in the node group, 
                    // BUT our connect logic below chains Input -> Output.
                    // Wait, standard bypass logic in node structure:
                    // Usually we disconnect. But here let's use the gain trick if possible.
                    // BETTER: Logic koneksi di bawah akan skip node jika dibypass
                }

                // Apply Params
                if(fxId === 'eq') {
                    group.nodes.low.gain.value = params.lowGain;
                    group.nodes.mid.gain.value = params.midGain;
                    group.nodes.high.gain.value = params.highGain;
                } else if(fxId === 'compressor') {
                    group.nodes.comp.threshold.value = params.threshold;
                    group.nodes.comp.ratio.value = params.ratio;
                    group.nodes.comp.attack.value = params.attack;
                    group.nodes.comp.release.value = params.release;
                } else if(fxId === 'delay') {
                    group.nodes.delay.delayTime.value = params.time;
                    group.nodes.feedback.gain.value = params.feedback;
                    group.nodes.dry.gain.value = 1 - params.mix;
                    group.nodes.wet.gain.value = params.mix;
                } else if(fxId === 'reverb') {
                    // Generate fresh IR for offline render
                    const decay = params.decay || 2.0;
                    group.nodes.conv.buffer = this.createImpulseResponse(offlineCtx, decay, decay);
                    group.nodes.dry.gain.value = 1 - params.mix;
                    group.nodes.wet.gain.value = params.mix;
                }
            }

            // 5. Connect the Chain (Offline)
            const source = offlineCtx.createBufferSource();
            source.buffer = this.state.audioBuffer;
            
            let head = source;
            this.state.fxChainOrder.forEach(id => {
                // Cek bypass state
                if (!this.state.fxParams[id].bypass) {
                    const node = offlineNodes[id];
                    if(node) { 
                        head.connect(node.input); 
                        head = node.output; 
                    }
                }
            });
            head.connect(offlineCtx.destination);

            // 6. Render
            source.start(0);
            const renderedBuffer = await offlineCtx.startRendering();

            // 7. Convert to WAV & Download
            const wavBlob = this.bufferToWave(renderedBuffer, renderedBuffer.length);
            const url = URL.createObjectURL(wavBlob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = `FX_Render_${Date.now()}.wav`;
            document.body.appendChild(a);
            a.click();

            // Cleanup
            setTimeout(() => {
                URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }, 100);

            this.showToast("Audio Berhasil Diexport!", 'success');

        } catch (e) {
            console.error("Export Failed:", e);
            this.showToast("Gagal Export Audio: " + e.message, 'error');
        } finally {
            // Reset Button State
            btn.innerHTML = originalText;
            btn.disabled = false;
            btn.classList.remove('btn-download-anim'); // Stop animation
        }
    }

    // Helper: Create Clean Reverb IR
    createImpulseResponse(ctx, duration, decay) {
        const rate = ctx.sampleRate;
        const length = rate * duration;
        const impulse = ctx.createBuffer(2, length, rate);
        const impulseL = impulse.getChannelData(0);
        const impulseR = impulse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            const n = i / length;
            // Exponential decay function
            const env = Math.pow(1 - n, decay);
            // White noise
            impulseL[i] = (Math.random() * 2 - 1) * env;
            impulseR[i] = (Math.random() * 2 - 1) * env;
        }
        return impulse;
    }

    // Helper: Convert AudioBuffer to WAV Blob (Robust 16-bit PCM)
    bufferToWave(abuffer, len) {
        const numOfChan = abuffer.numberOfChannels;
        const length = len * numOfChan * 2 + 44;
        const buffer = new ArrayBuffer(length);
        const view = new DataView(buffer);
        const channels = [];
        let i, sample;
        let offset = 0;
        let pos = 0;

        // Write WAV Header
        setUint32(0x46464952); // "RIFF"
        setUint32(length - 8); // file length - 8
        setUint32(0x45564157); // "WAVE"

        setUint32(0x20746d66); // "fmt " chunk
        setUint32(16);         // length = 16
        setUint16(1);          // PCM (uncompressed)
        setUint16(numOfChan);
        setUint32(abuffer.sampleRate);
        setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
        setUint16(numOfChan * 2); // block-align
        setUint16(16);            // 16-bit (hardcoded)

        setUint32(0x61746164); // "data" - chunk
        setUint32(length - pos - 4); // chunk length

        // Interleave channels
        for(i = 0; i < abuffer.numberOfChannels; i++)
            channels.push(abuffer.getChannelData(i));

        while(pos < length) {
            for(i = 0; i < numOfChan; i++) {
                // Clamp and convert to 16-bit PCM
                sample = Math.max(-1, Math.min(1, channels[i][offset]));
                // Bit manipulation for 16-bit signed integer
                sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(pos, sample, true); 
                pos += 2;
            }
            offset++;
        }

        return new Blob([buffer], { type: "audio/wav" });

        function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
        function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }
    }

    async handleFileLoad(e) {
        const file = e.target.files[0];
        if (!file) return;
        if(this.state.isPlaying) this.pause();
        
        this.dom.fileName.textContent = "Loading...";
        this.dom.playBtn.disabled = true;
        this.dom.downloadBtn.disabled = true;

        try {
            const buffer = await file.arrayBuffer();
            this.state.audioBuffer = await this.audio.ctx.decodeAudioData(buffer);
            this.state.fileLoaded = true;
            this.dom.fileName.textContent = file.name;
            this.dom.totalDuration.textContent = this.formatTime(this.state.audioBuffer.duration);
            this.dom.playBtn.disabled = false;
            this.dom.downloadBtn.disabled = false;
            this.state.startOffset = 0;
            this.visualizers.waveform.draw(this.state.audioBuffer);
            this.showToast("File Loaded Successfully", 'success');
        } catch (err) {
            this.dom.fileName.textContent = "Error Loading File";
            console.error(err);
            this.showToast("Gagal memuat file audio (Format tidak didukung?)", 'error');
        }
    }

    play() {
        if(!this.state.fileLoaded) return;
        this.audio.sourceNode = this.audio.ctx.createBufferSource();
        this.audio.sourceNode.buffer = this.state.audioBuffer;
        
        // Connect live chain
        this.connectFXChain(this.audio.sourceNode, this.audio.masterGain);
        
        this.state.startTime = this.audio.ctx.currentTime;
        this.audio.sourceNode.start(0, this.state.startOffset);
        this.state.isPlaying = true;
        this.dom.playIcon.className = 'fa-solid fa-pause';
        this.animate();
    }

    pause() {
        if(this.audio.sourceNode) {
            try { this.audio.sourceNode.stop(); } catch(e){}
        }
        if(this.state.isPlaying) {
            this.state.startOffset += this.audio.ctx.currentTime - this.state.startTime;
            if(this.state.startOffset >= this.state.audioBuffer.duration) this.state.startOffset = 0;
        }
        this.state.isPlaying = false;
        this.dom.playIcon.className = 'fa-solid fa-play';
        cancelAnimationFrame(this.rafId);
    }

    connectFXChain(source, dest) {
        source.disconnect();
        let head = source;
        this.state.fxChainOrder.forEach(id => {
            // Only connect if NOT bypassed
            if(!this.state.fxParams[id].bypass) {
                const node = this.audio.nodes[id];
                if(node) { head.connect(node.input); head = node.output; }
            }
        });
        head.connect(dest);
    }

    renderFXChain() {
        this.dom.fxChainContainer.innerHTML = '';
        if(this.state.fxChainOrder.length > 0) this.dom.emptyMsg.style.display = 'none';
        this.state.fxChainOrder.forEach(id => {
            if(EFFECTS_CONFIG[id]) this.dom.fxChainContainer.appendChild(this.createModule(id, EFFECTS_CONFIG[id]));
        });
        this.applyParams();
    }

    createModule(id, config) {
        const clone = this.dom.moduleTemplate.content.cloneNode(true);
        const card = clone.querySelector('.fx-card');
        card.dataset.fxId = id;
        card.querySelector('.module-icon').className = config.icon;
        card.querySelector('.fx-name').textContent = config.name;
        
        const toggle = card.querySelector('.bypass-toggle');
        toggle.checked = !this.state.fxParams[id].bypass;
        toggle.addEventListener('change', (e) => {
            this.state.fxParams[id].bypass = !e.target.checked;
            // Reconnect chain to effectively bypass audio path
            if(this.state.isPlaying) {
                // Store current time position
                this.pause(); 
                this.play();
            }
            card.classList.toggle('bypassed', this.state.fxParams[id].bypass);
        });
        if(this.state.fxParams[id].bypass) card.classList.add('bypassed');

        const body = card.querySelector('.fx-body');
        for(const paramId in config.params) {
            body.appendChild(this.createSlider(id, paramId, config.params[paramId]));
        }
        
        return card;
    }

    createSlider(fxId, paramId, conf) {
        const group = document.createElement('div');
        const isVertical = conf.type === 'v-slider';
        group.className = `slider-group ${isVertical ? 'vertical' : 'horizontal'}`;
        
        const input = document.createElement('input');
        input.type = 'range';
        input.min = conf.min;
        input.max = conf.max; input.step = conf.step;
        input.value = this.state.fxParams[fxId][paramId];
        if(isVertical) input.setAttribute('orient', 'vertical');

        const label = document.createElement('span');
        label.className = 'param-label';
        label.textContent = conf.name;
        
        const valDisplay = document.createElement('span');
        valDisplay.className = 'param-value';
        
        const updateVal = (v) => {
            let txt = parseFloat(v).toFixed(conf.step < 0.1 ? 2 : 1);
            if(conf.unit === '%') txt = Math.round(v * 100) + '%';
            else if(conf.unit === 'dB') txt = (v > 0 ? '+' : '') + Math.round(v) + 'dB';
            else if(conf.unit === ':1') txt = v + ':1';
            else txt += conf.unit;
            valDisplay.textContent = txt;
        };

        input.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.state.fxParams[fxId][paramId] = v;
            this.updateNodeParam(fxId, paramId, v);
            updateVal(v);
        });

        input.addEventListener('dblclick', () => {
            input.value = conf.value;
            this.state.fxParams[fxId][paramId] = conf.value;
            this.updateNodeParam(fxId, paramId, conf.value);
            updateVal(conf.value);
            valDisplay.classList.add('reset-flash');
            setTimeout(() => valDisplay.classList.remove('reset-flash'), 300);
        });

        updateVal(input.value);
        
        if(isVertical) {
            group.appendChild(valDisplay);
            group.appendChild(input);
            group.appendChild(label);
        } else {
            group.appendChild(label);
            group.appendChild(input);
            group.appendChild(valDisplay);
        }

        return group;
    }

    updateNodeParam(fxId, paramId, value) {
        // Live update only for active nodes
        const group = this.audio.nodes[fxId];
        if(!group) return;
        const t = this.audio.ctx.currentTime;
        
        if(paramId === 'bypass') return; // Handled by reconnection

        const nodes = group.nodes;
        if(fxId === 'eq') {
            if(paramId === 'lowGain') nodes.low.gain.setTargetAtTime(value, t, 0.1);
            if(paramId === 'midGain') nodes.mid.gain.setTargetAtTime(value, t, 0.1);
            if(paramId === 'highGain') nodes.high.gain.setTargetAtTime(value, t, 0.1);
        } else if(fxId === 'compressor') {
             if(nodes.comp[paramId]) nodes.comp[paramId].setTargetAtTime(value, t, 0.1);
        } else if(fxId === 'delay') {
            if(paramId === 'time') nodes.delay.delayTime.setTargetAtTime(value, t, 0.2);
            if(paramId === 'feedback') nodes.feedback.gain.setTargetAtTime(value, t, 0.1);
            if(paramId === 'mix') { 
                nodes.dry.gain.setTargetAtTime(1-value, t, 0.01);
                nodes.wet.gain.setTargetAtTime(value, t, 0.01); 
            }
        } else if(fxId === 'reverb') {
            if(paramId === 'mix') { 
                nodes.dry.gain.setTargetAtTime(1-value, t, 0.01);
                nodes.wet.gain.setTargetAtTime(value, t, 0.01); 
            }
        }
    }

    applyParams() {
        for(const fx in this.state.fxParams) {
            for(const p in this.state.fxParams[fx]) {
                this.updateNodeParam(fx, p, this.state.fxParams[fx][p]);
            }
        }
    }

    loop() {
        this.rafId = requestAnimationFrame(this.loop.bind(this));
        if(this.state.isPlaying) {
            const now = this.audio.ctx.currentTime;
            const elapsed = now - this.state.startTime;
            const progress = (this.state.startOffset + elapsed) / this.state.audioBuffer.duration;
            this.updatePlayhead(progress);
            this.dom.currentTime.textContent = this.formatTime(this.state.startOffset + elapsed);
        }
        
        this.visualizers.oscilloscope?.draw();
        this.visualizers.spectrogram?.draw();
        this.updateMeter();
    }

    updateMeter() {
        this.audio.analyser.getFloatTimeDomainData(this.audio.meterData);
        let sum = 0, peak = 0;
        for(let i=0; i<this.audio.meterData.length; i+=4) { 
            const a = this.audio.meterData[i];
            sum += a*a; 
            if(Math.abs(a) > peak) peak = Math.abs(a); 
        }
        const rms = Math.sqrt(sum / (this.audio.meterData.length/4));
        const db = 20 * Math.log10(rms || 0.0001);
        
        const pct = Math.min(100, Math.max(0, (db + 60) / 60 * 100));
        this.dom.masterMeterBar.style.width = `${pct}%`;
        this.dom.masterReadout.textContent = `${db.toFixed(1)} dB`;
        
        if (peak > this.state.masterPeak) { 
            this.state.masterPeak = peak;
            this.state.lastPeakTime = Date.now();
        } else if (Date.now() - this.state.lastPeakTime > 1000) { 
            this.state.masterPeak *= 0.95;
        }
        const peakDb = 20 * Math.log10(this.state.masterPeak || 0.0001);
        const peakPct = Math.min(100, Math.max(0, (peakDb + 60) / 60 * 100));
        this.dom.masterPeak.style.left = `${peakPct}%`;
        this.dom.masterPeak.style.display = 'block';
    }

    updatePlayhead(pct = 0) {
        if(pct > 1) pct = 1;
        this.dom.playhead.style.left = `${pct * 100}%`;
        this.dom.progressCanvas.style.width = `${pct * 100}%`;
    }

    formatTime(s) {
        if(isNaN(s)) return "0:00";
        const m = Math.floor(s/60);
        const sc = Math.floor(s%60);
        return `${m}:${sc.toString().padStart(2,'0')}`;
    }
    
    showToast(msg, type = 'info') {
        const t = document.createElement('div');
        t.className = `toast ${type}`; 
        t.innerHTML = `<i class="fa-solid ${type==='error'?'fa-circle-exclamation':type==='success'?'fa-check-circle':'fa-info-circle'}"></i> ${msg}`;
        this.dom.toastContainer.appendChild(t);
        setTimeout(() => {
            t.classList.add('fade-out');
            setTimeout(() => t.remove(), 300);
        }, 3000);
    }

    // Helper: Animation loop for playback
    animate() {
       // Included in loop() 
    }
}

// --- VISUALIZER CLASSES ---
class Waveform {
    constructor(canvas, progressCanvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.pCanvas = progressCanvas; this.pCtx = progressCanvas.getContext('2d');
        this.resize(); window.addEventListener('resize', ()=>this.resize());
    }
    resize() {
        this.canvas.width = this.canvas.offsetWidth; this.canvas.height = this.canvas.offsetHeight;
        this.pCanvas.width = this.pCanvas.offsetWidth; this.pCanvas.height = this.pCanvas.offsetHeight;
        if(this.data) this.draw(this.data);
    }
    draw(buffer) {
        if(buffer) this.data = buffer;
        const d = this.data.getChannelData(0);
        const step = Math.ceil(d.length / this.canvas.width);
        const amp = this.canvas.height / 2;
        const drawCtx = (ctx, color) => {
            ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height);
            ctx.fillStyle = color;
            ctx.beginPath();
            for(let i=0; i<this.canvas.width; i++) {
                let min = 1.0, max = -1.0;
                for(let j=0; j<step; j++) {
                    const val = d[i*step + j];
                    if(val < min) min = val;
                    if(val > max) max = val;
                }
                ctx.fillRect(i, amp * (1 + min), 1, Math.max(1, (max-min)*amp));
            }
        };
        drawCtx(this.ctx, getComputedStyle(document.documentElement).getPropertyValue('--text-muted'));
        drawCtx(this.pCtx, '#fff');
    }
}

class Oscilloscope {
    constructor(canvas, analyser) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.analyser = analyser;
        this.data = new Uint8Array(analyser.frequencyBinCount);
    }
    draw() {
        const w = this.canvas.width = this.canvas.offsetWidth;
        const h = this.canvas.height = this.canvas.offsetHeight;
        this.analyser.getByteTimeDomainData(this.data);
        this.ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-card');
        this.ctx.fillRect(0, 0, w, h);
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent');
        this.ctx.beginPath();
        const sliceWidth = w * 1.0 / this.data.length;
        let x = 0;
        for(let i=0; i<this.data.length; i++) {
            const v = this.data[i] / 128.0;
            const y = v * h/2;
            if(i===0) this.ctx.moveTo(x,y); else this.ctx.lineTo(x,y);
            x += sliceWidth;
        }
        this.ctx.stroke();
    }
}

class Spectrogram {
    constructor(canvas, analyser) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.analyser = analyser;
        this.data = new Uint8Array(analyser.frequencyBinCount);
    }
    draw() {
        const w = this.canvas.width = this.canvas.offsetWidth;
        const h = this.canvas.height = this.canvas.offsetHeight;
        this.analyser.getByteFrequencyData(this.data);
        this.ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-card');
        this.ctx.fillRect(0, 0, w, h);
        const barW = (w / this.data.length) * 2.5;
        let x = 0;
        for(let i=0; i<this.data.length; i++) {
            const barH = (this.data[i] / 255) * h;
            this.ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent');
            this.ctx.globalAlpha = 0.6;
            this.ctx.fillRect(x, h-barH, barW, barH);
            x += barW + 1;
        }
    }
}

function getDragAfterElement(container, x) {
    const draggableElements = [...container.querySelectorAll('.fx-card:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = x - box.left - box.width / 2;
        if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
        else return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

window.addEventListener('DOMContentLoaded', () => new DAWApp().init());
