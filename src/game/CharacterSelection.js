import { CharacterGraphics } from './CharacterGraphics.js';

export class CharacterSelection {
    constructor(container) {
        this.container = container;
        this.truckThemes = ['monster', 'dinosaur', 'space', 'bumblebee', 'plane'];
        this.drivers = ['gabby', 'daniel_tiger', 'ms_rachel'];

        this.currentThemeIndex = 0;
        this.currentColorIndex = 0;
        this.currentDriverIndex = 0;
    }

    render() {
        this.container.innerHTML = `
            <div id="character-selection" style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100vh;
                background-color: #1a1a2e;
                color: white;
                font-family: Arial, sans-serif;
            ">
                <h1 style="margin-bottom: 20px;">Choose Your Ride!</h1>
                
                <div id="preview-container" style="
                    position: relative;
                    width: 500px;
                    height: 300px;
                    background: #2a2a4e;
                    border-radius: 15px;
                    border: 4px solid #4a4e69;
                    box-shadow: 0 10px 20px rgba(0,0,0,0.5);
                    overflow: hidden;
                    margin-bottom: 30px;
                ">
                    <div id="truck-preview" style="position: absolute; bottom: 0; left: 0; width: 100%; height: 100%;"></div>
                    <div id="driver-preview" style="position: absolute; bottom: 60px; left: 160px; width: 120px; height: 120px; z-index: 2;"></div>
                </div>

                <div class="controls" style="display: flex; gap: 40px;">
                    <!-- Theme Controls -->
                    <div class="control-group" style="text-align: center;">
                        <h3>Truck Style</h3>
                        <div style="display: flex; align-items: center; gap: 10px; justify-content: center;">
                            <button id="prev-theme" style="${this.btnStyle()}">◀</button>
                            <span id="theme-label" style="width: 100px; text-transform: uppercase;">Monster</span>
                            <button id="next-theme" style="${this.btnStyle()}">▶</button>
                        </div>
                    </div>

                    <!-- Color Controls -->
                    <div class="control-group" style="text-align: center;">
                        <h3>Color</h3>
                        <div style="display: flex; align-items: center; gap: 10px; justify-content: center;">
                            <button id="prev-color" style="${this.btnStyle()}">◀</button>
                            <div id="color-preview" style="width: 30px; height: 30px; border-radius: 50%; border: 2px solid white;"></div>
                            <button id="next-color" style="${this.btnStyle()}">▶</button>
                        </div>
                    </div>

                    <!-- Driver Controls -->
                    <div class="control-group" style="text-align: center;">
                        <h3>Driver</h3>
                        <div style="display: flex; align-items: center; gap: 10px; justify-content: center;">
                            <button id="prev-driver" style="${this.btnStyle()}">◀</button>
                            <span id="driver-label" style="width: 100px; text-transform: capitalize;">Gabby</span>
                            <button id="next-driver" style="${this.btnStyle()}">▶</button>
                        </div>
                    </div>
                </div>

                <button id="start-game" style="
                    margin-top: 40px;
                    padding: 15px 40px;
                    font-size: 24px;
                    font-weight: bold;
                    background: linear-gradient(45deg, #ff9800, #ff5722);
                    color: white;
                    border: none;
                    border-radius: 30px;
                    cursor: pointer;
                    box-shadow: 0 5px 15px rgba(255,87,34,0.4);
                    transition: transform 0.2s;
                ">LET'S DRIVE!</button>
            </div>
        `;

        this.bindEvents();
        this.updatePreview();
    }

    btnStyle() {
        return `
            background: #4a4e69;
            color: white;
            border: none;
            border-radius: 5px;
            padding: 10px;
            cursor: pointer;
            font-size: 16px;
        `;
    }

    bindEvents() {
        document.getElementById('prev-theme').addEventListener('click', () => {
            this.currentThemeIndex = (this.currentThemeIndex - 1 + this.truckThemes.length) % this.truckThemes.length;
            this.currentColorIndex = 0; // Reset color on theme change
            this.updatePreview();
        });
        document.getElementById('next-theme').addEventListener('click', () => {
            this.currentThemeIndex = (this.currentThemeIndex + 1) % this.truckThemes.length;
            this.currentColorIndex = 0;
            this.updatePreview();
        });

        document.getElementById('prev-color').addEventListener('click', () => {
            const colors = this.getCurrentColors();
            this.currentColorIndex = (this.currentColorIndex - 1 + colors.length) % colors.length;
            this.updatePreview();
        });
        document.getElementById('next-color').addEventListener('click', () => {
            const colors = this.getCurrentColors();
            this.currentColorIndex = (this.currentColorIndex + 1) % colors.length;
            this.updatePreview();
        });

        document.getElementById('prev-driver').addEventListener('click', () => {
            this.currentDriverIndex = (this.currentDriverIndex - 1 + this.drivers.length) % this.drivers.length;
            this.updatePreview();
        });
        document.getElementById('next-driver').addEventListener('click', () => {
            this.currentDriverIndex = (this.currentDriverIndex + 1) % this.drivers.length;
            this.updatePreview();
        });

        document.getElementById('start-game').addEventListener('click', () => {
            console.log('Starting game with:', {
                theme: this.truckThemes[this.currentThemeIndex],
                color: this.getCurrentColor(),
                driver: this.drivers[this.currentDriverIndex]
            });
            // Here you would transition to the actual game logic, passing the selected config
            alert('Ready to race!');
        });
    }

    getCurrentColors() {
        return CharacterGraphics.getTruckColors(this.truckThemes[this.currentThemeIndex]);
    }

    getCurrentColor() {
        return this.getCurrentColors()[this.currentColorIndex];
    }

    updatePreview() {
        const theme = this.truckThemes[this.currentThemeIndex];
        const color = this.getCurrentColor();
        const driver = this.drivers[this.currentDriverIndex];

        // Update Labels
        document.getElementById('theme-label').textContent = theme;
        document.getElementById('driver-label').textContent = driver.replace('_', ' ');
        document.getElementById('color-preview').style.backgroundColor = color;

        // Render SVGs
        document.getElementById('truck-preview').innerHTML = CharacterGraphics.generateTruckSVG(theme, color);
        document.getElementById('driver-preview').innerHTML = CharacterGraphics.generateDriverSVG(driver);
    }
}
