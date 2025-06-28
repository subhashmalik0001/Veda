class EEGBLEController {
    constructor() {
        this.device = null;
        this.server = null;
        this.service = null;
        this.characteristic = null;
        this.isConnected = false;
        this.menuActive = false;
        this.currentSelection = 0;
        
        this.SERVICE_UUID = "6910123a-eb0d-4c35-9a60-bebe1dcb549d";
        this.CHAR_UUID = "5f4f1107-7fc1-43b2-a540-0aa1a9f1ce78";
        
        this.initElements();
        this.bindEvents();
        this.initializeUI();
        this.initializeSpeech();
    }

    initElements() {
        this.statusEl = document.getElementById('status');
        this.connectBtn = document.getElementById('connectBtn');
        this.menuStatusEl = document.getElementById('menuStatus');
        this.menuButtons = document.querySelectorAll('.menu-option');
        this.logsEl = document.getElementById('logs');
    }

    bindEvents() {
        this.connectBtn.addEventListener('click', () => this.toggleConnection());
        
        this.menuButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const option = parseInt(e.currentTarget.dataset.option);
                this.selectOption(option);
            });
        });
    }

    initializeUI() {
        // Add some initial logs
        setTimeout(() => this.log('EEG signal processing initialized', 'info'), 500);
        setTimeout(() => this.log('Neural pattern recognition ready', 'info'), 1000);
        setTimeout(() => this.log('Waiting for device connection...', 'info'), 1500);
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.textContent = `[${timestamp}] ${message}`;
        
        this.logsEl.appendChild(logEntry);
        this.logsEl.scrollTop = this.logsEl.scrollHeight;
        
        // Keep only last 50 log entries
        while (this.logsEl.children.length > 50) {
            this.logsEl.removeChild(this.logsEl.firstChild);
        }
    }

    async toggleConnection() {
        if (this.isConnected) {
            await this.disconnect();
        } else {
            await this.connect();
        }
    }

    async connect() {
        try {
            this.log('Scanning for BLE devices...');
            this.connectBtn.disabled = true;

            // Request device - use acceptAllDevices to see all services
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ name: 'ESP32C6_EEG' }],
                optionalServices: [this.SERVICE_UUID]
            });

            this.log(`Found device: ${this.device.name}`, 'success');

            // Connect to GATT server
            this.server = await this.device.gatt.connect();
            this.log('Connected to GATT server', 'success');

            // First, let's see what services are actually available
            try {
                const services = await this.server.getPrimaryServices();
                this.log(`Found ${services.length} services:`);
                for (let service of services) {
                    this.log(`- Service: ${service.uuid}`);
                }
            } catch (serviceListError) {
                this.log(`Could not list services: ${serviceListError.message}`, 'error');
            }

            // Try to get our specific service
            try {
                this.service = await this.server.getPrimaryService(this.SERVICE_UUID);
                this.log('Successfully found the EEG service', 'success');
            } catch (serviceError) {
                this.log(`Service not found with UUID ${this.SERVICE_UUID}`, 'error');
                this.log('This might be because:', 'error');
                this.log('1. The ESP32 is not advertising this service UUID', 'error');
                this.log('2. The service is not started on the ESP32', 'error');
                this.log('3. There might be a UUID mismatch', 'error');
                throw new Error(`Service not found: ${serviceError.message}`);
            }

            // Get characteristics from the service
            const characteristics = await this.service.getCharacteristics();
            this.log(`Found ${characteristics.length} characteristics:`);
            for (let char of characteristics) {
                this.log(`- Characteristic: ${char.uuid}`);
                this.log(`  Properties: ${Object.keys(char.properties).filter(prop => char.properties[prop]).join(', ')}`);
            }

            // Try to get our specific characteristic
            try {
                this.characteristic = await this.service.getCharacteristic(this.CHAR_UUID);
                this.log('Successfully found the notification characteristic', 'success');
            } catch (charError) {
                this.log(`Characteristic not found with UUID ${this.CHAR_UUID}`, 'error');
                // Try to find any characteristic with notify property
                let notifyChar = null;
                for (let char of characteristics) {
                    if (char.properties.notify) {
                        notifyChar = char;
                        this.log(`Found alternative notify characteristic: ${char.uuid}`, 'info');
                        break;
                    }
                }
                if (notifyChar) {
                    this.characteristic = notifyChar;
                    this.log('Using alternative notify characteristic', 'info');
                } else {
                    throw new Error(`No notification characteristic found: ${charError.message}`);
                }
            }

            // Verify the characteristic has notify property
            if (!this.characteristic.properties.notify) {
                throw new Error('Characteristic does not support notifications');
            }

            // Start notifications
            await this.characteristic.startNotifications();
            this.characteristic.addEventListener('characteristicvaluechanged', 
                (event) => this.handleNotification(event));
            
            this.log('Notifications started successfully', 'success');

            // Handle disconnection
            this.device.addEventListener('gattserverdisconnected', 
                () => this.onDisconnected());

            this.isConnected = true;
            this.updateUI();
            this.log('Successfully connected to EEG device!', 'success');

        } catch (error) {
            this.log(`Connection failed: ${error.message}`, 'error');
            this.connectBtn.disabled = false;
        }
    }

    async disconnect() {
        try {
            if (this.device && this.device.gatt.connected) {
                await this.device.gatt.disconnect();
            }
            this.log('Disconnected from device', 'info');
        } catch (error) {
            this.log(`Disconnect error: ${error.message}`, 'error');
        }
        this.onDisconnected();
    }

    onDisconnected() {
        this.isConnected = false;
        this.menuActive = false;
        this.currentSelection = 0;
        this.device = null;
        this.server = null;
        this.service = null;
        this.characteristic = null;
        
        this.updateUI();
        this.log('Device disconnected', 'error');
    }

    handleNotification(event) {
        const data = new Uint8Array(event.target.value.buffer);
        
        if (data.length === 1) {
            const command = data[0];
            
            if (command === 0) {
                // Menu activated
                this.menuActive = true;
                this.currentSelection = 0;
                this.log('Menu activated - waiting for selection', 'success');
                this.speak('Menu activated. Please focus on an option.');
                this.updateUI();
            } else if (command === 127) {
                // Menu deactivated
                this.menuActive = false;
                this.currentSelection = 0;
                this.log('Menu deactivated', 'info');
                this.speak('Menu deactivated');
                this.updateUI();
            }
        } else if (data.length === 2) {
            const command = String.fromCharCode(data[0]);
            const value = data[1];
            
            if (command === 'S') {
                // Switch selection
                this.currentSelection = value;
                const optionName = this.getOptionName(value);
                this.log(`Selection switched to option ${value}`, 'info');
                this.speak(optionName); // 🧠 Speak when focused
                this.updateUI();
            } else if (command === 'A') {
                // Option selected
                const optionName = this.getOptionName(value);
                this.log(`Option selected: ${optionName}`, 'success');
                this.speak(this.getOptionName(value));
                this.showSelectionFeedback(value);
            }
        }
    }

    selectOption(option) {
        if (!this.isConnected || !this.menuActive) {
            this.log('Menu not active or device not connected', 'error');
            return;
        }
        
        const optionName = this.getOptionName(option);
        this.log(`Manual selection: ${optionName}`, 'success');
        this.speak(optionName);
        this.showSelectionFeedback(option);
    }

    getOptionName(option) {
        const names = {
            1: 'Food',
            2: 'Water', 
            3: 'Washroom',
            4: 'Help',
            5: 'Entertainment',
            6: 'Air Control'
        };
        return names[option] || 'Unknown';
    }

    showSelectionFeedback(option) {
        // Visual feedback for selection
        const btn = document.querySelector(`[data-option="${option}"]`);
        if (btn) {
            btn.classList.add('selected');
            setTimeout(() => {
                btn.classList.remove('selected');
            }, 3000);
        }
    }

    updateUI() {
        // Update connection status
        if (this.isConnected) {
            this.statusEl.innerHTML = '<div class="status-dot"></div><span>Connected</span>';
            this.statusEl.className = 'status-indicator connected';
            this.connectBtn.innerHTML = '<span>🔌</span>Disconnect';
            this.connectBtn.disabled = false;
        } else {
            this.statusEl.innerHTML = '<div class="status-dot"></div><span>Disconnected</span>';
            this.statusEl.className = 'status-indicator disconnected';
            this.connectBtn.innerHTML = '<span>⚡</span>Connect Device';
            this.connectBtn.disabled = false;
        }

        // Update menu status
        if (this.menuActive) {
            this.menuStatusEl.textContent = `Active ${this.currentSelection ? `(Selection: ${this.currentSelection})` : '(Waiting for selection)'}`;
        } else {
            this.menuStatusEl.textContent = 'Inactive';
        }

        // Update menu buttons
        this.menuButtons.forEach((btn, index) => {
            const option = index + 1;
            
            if (this.isConnected && this.menuActive) {
                btn.disabled = false;
                
                if (option === this.currentSelection) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            } else {
                btn.disabled = true;
                btn.classList.remove('active');
            }
        });
    }

    initializeSpeech() {
        // Initialize speech synthesis and log available voices
        if ('speechSynthesis' in window) {
            // Wait for voices to load
            speechSynthesis.onvoiceschanged = () => {
                const voices = speechSynthesis.getVoices();
                this.log(`Speech synthesis initialized with ${voices.length} voices available`, 'info');
                console.log('Available voices:', voices);
            };
        } else {
            this.log('Speech Synthesis not supported in this browser.', 'error');
        }
    }

    speak(text) {
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'en-US';
            utterance.volume = 1;
            utterance.rate = 1;
            utterance.pitch = 1;
            speechSynthesis.cancel(); // cancel any previous speech
            speechSynthesis.speak(utterance);
        } else {
            this.log('Speech Synthesis not supported in this browser.', 'error');
        }
    }
}

// Check for Web Bluetooth support
if ('bluetooth' in navigator) {
    const controller = new EEGBLEController();
} else {
    document.body.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; padding: 20px;">
            <div style="background: rgba(26, 26, 26, 0.6); backdrop-filter: blur(20px); border: 1px solid #1a1a1a; border-radius: 20px; padding: 40px; max-width: 500px;">
                <div style="font-size: 3rem; margin-bottom: 20px;">❌</div>
                <h1 style="color: #ef4444; margin-bottom: 16px;">Bluetooth Not Supported</h1>
                <p style="color: #a3a3a3; line-height: 1.6;">This browser doesn't support Web Bluetooth API. Please use Chrome, Edge, or another compatible browser to access EEG device functionality.</p>
            </div>
        </div>
    `;
}