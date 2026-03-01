export class CharacterGraphics {
    static getTruckColors(theme) {
        const colors = {
            monster: ['#ff0000', '#00ff00', '#0000ff', '#ff00ff'],
            dinosaur: ['#4caf50', '#8bc34a', '#cddc39', '#ff9800'],
            space: ['#9c27b0', '#673ab7', '#3f51b5', '#2196f3'],
            bumblebee: ['#ffeb3b', '#fbc02d', '#f57f17', '#e65100'],
            barbie: ['#ff4081', '#f06292', '#f48fb1', '#fce4ec'],
            plane: ['#f8f9fa', '#e9ecef', '#dee2e6', '#ced4da']
        };
        return colors[theme] || colors.monster;
    }

    static generateTruckSVG(theme, color) {
        let themeDecorations = '';
        let baseBody = `
            <!-- Truck Body Base -->
            <path d="M 50 150 L 50 200 L 400 200 L 400 150 L 320 100 L 120 100 Z" fill="${color}" />
            
            <!-- Window -->
            <path d="M 130 110 L 310 110 L 380 150 L 130 150 Z" fill="#81d4fa" opacity="0.8" />
        `;

        if (theme === 'monster') {
            themeDecorations = `
                <!-- Monster Teeth -->
                <path d="M 300 200 L 320 230 L 340 200 Z" fill="#ffffff" />
                <path d="M 340 200 L 360 230 L 380 200 Z" fill="#ffffff" />
                <!-- Monster Horns -->
                <path d="M 120 100 Q 100 50 140 20 Q 150 70 160 100 Z" fill="#eeeeee" />
                <path d="M 180 100 Q 160 50 200 20 Q 210 70 220 100 Z" fill="#eeeeee" />
            `;
        } else if (theme === 'dinosaur') {
            themeDecorations = `
                <!-- Dinosaur Spikes -->
                <polygon points="100,100 130,50 160,100" fill="#2e7d32" />
                <polygon points="160,100 190,50 220,100" fill="#2e7d32" />
                <polygon points="220,100 250,50 280,100" fill="#2e7d32" />
                <polygon points="280,100 310,50 340,100" fill="#2e7d32" />
                <!-- Dinosaur Tail -->
                <path d="M 50 150 Q 0 150 -50 100 Q 0 200 50 200 Z" fill="${color}" />
            `;
        } else if (theme === 'space') {
            themeDecorations = `
                <!-- Rocket Boosters -->
                <rect x="20" y="160" width="40" height="30" rx="5" fill="#555555" />
                <polygon points="20,160 0,175 20,190" fill="#ff5722" />
                <!-- Sci-fi Dome -->
                <path d="M 120 100 A 100 80 0 0 1 300 100 Z" fill="#00bcd4" opacity="0.6" />
            `;
        } else if (theme === 'bumblebee') {
            themeDecorations = `
                <!-- Racing Stripes -->
                <rect x="150" y="100" width="20" height="100" fill="#000000" transform="skewX(-20)" />
                <rect x="180" y="100" width="20" height="100" fill="#000000" transform="skewX(-20)" />
                <rect x="210" y="100" width="20" height="100" fill="#000000" transform="skewX(-20)" />
                <!-- Camaro Grill -->
                <rect x="350" y="140" width="30" height="40" rx="5" fill="#333333" />
                <circle cx="365" cy="150" r="8" fill="#ffff00" />
                <circle cx="365" cy="170" r="8" fill="#ffff00" />
            `;
        } else if (theme === 'barbie') {
            baseBody = `
                <!-- Convertible Body (lower profile, no roof) -->
                <path d="M 50 150 L 50 200 L 400 200 L 400 150 L 380 130 L 80 130 Z" fill="${color}" />
                <!-- White Racing Stripe -->
                <rect x="50" y="165" width="350" height="15" fill="#ffffff" />
                <!-- Windshield (angled back) -->
                <path d="M 280 130 L 330 90 L 340 90 L 290 130 Z" fill="#81d4fa" opacity="0.8" />
                <!-- Headlights -->
                <circle cx="390" cy="160" r="10" fill="#ffffff" />
                <circle cx="390" cy="160" r="5" fill="#ffff00" />
            `;
        } else if (theme === 'plane') {
            baseBody = `
                <!-- Plane Fuselage -->
                <path d="M 50 150 Q 50 100 225 100 Q 400 100 400 150 Q 400 200 225 200 Q 50 200 50 150 Z" fill="${color}" />
                <!-- Cockpit Window -->
                <path d="M 280 115 Q 350 115 350 140 L 280 140 Z" fill="#81d4fa" opacity="0.8" />
            `;
            themeDecorations = `
                <!-- Tail Fin -->
                <path d="M 80 110 L 110 40 L 150 40 L 130 110 Z" fill="#555" />
                <!-- Wing -->
                <path d="M 200 150 L 260 150 L 300 230 L 180 230 Z" fill="#777" opacity="0.9" />
                <!-- Propeller -->
                <ellipse cx="400" cy="150" rx="10" ry="40" fill="#333" />
                <circle cx="400" cy="150" r="12" fill="#ff0000" />
            `;
        }

        return `
            <svg viewBox="-25 0 500 300" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                
                ${baseBody}
                
                ${themeDecorations}
                
                <!-- Tires -->
                <circle cx="125" cy="250" r="40" fill="#222" />
                <circle cx="125" cy="250" r="25" fill="#777" />
                <circle cx="125" cy="250" r="10" fill="#333" />
                
                <circle cx="325" cy="250" r="40" fill="#222" />
                <circle cx="325" cy="250" r="25" fill="#777" />
                <circle cx="325" cy="250" r="10" fill="#333" />
            </svg>
        `;
    }

    static generateDriverSVG(driver) {
        let driverFeatures = '';

        if (driver === 'gabby') {
            driverFeatures = `
                <!-- Cat Ears -->
                <polygon points="70,50 85,20 100,60" fill="#333" />
                <polygon points="130,60 145,20 160,50" fill="#333" />
                <!-- Hair -->
                <path d="M 60 100 Q 60 40 115 40 Q 170 40 170 100 Q 190 140 170 180 Q 150 120 115 120 Q 80 120 60 180 Q 40 140 60 100 Z" fill="#4e342e" />
                <!-- Face -->
                <circle cx="115" cy="110" r="40" fill="#ffccbc" />
                <!-- Eyes -->
                <circle cx="100" cy="100" r="5" fill="#000" />
                <circle cx="130" cy="100" r="5" fill="#000" />
                <!-- Smile -->
                <path d="M 100 120 Q 115 135 130 120" fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" />
            `;
        } else if (driver === 'daniel_tiger') {
            driverFeatures = `
                <!-- Tiger Ears -->
                <circle cx="75" cy="55" r="15" fill="#ff9800" />
                <circle cx="155" cy="55" r="15" fill="#ff9800" />
                <!-- Face -->
                <circle cx="115" cy="100" r="45" fill="#ff9800" />
                <circle cx="115" cy="115" r="20" fill="#fff" />
                <!-- Stripes -->
                <polygon points="105,60 115,75 125,60" fill="#000" />
                <polygon points="75,80 90,90 70,100" fill="#000" />
                <polygon points="155,80 140,90 160,100" fill="#000" />
                <!-- Eyes -->
                <circle cx="95" cy="95" r="4" fill="#000" />
                <circle cx="135" cy="95" r="4" fill="#000" />
                <!-- Nose -->
                <circle cx="115" cy="110" r="4" fill="#000" />
                <!-- Red Sweater -->
                <path d="M 70 140 L 160 140 L 180 200 L 50 200 Z" fill="#f44336" />
                <path d="M 115 140 L 115 200" fill="none" stroke="#fff" stroke-width="2" />
            `;
        } else if (driver === 'ms_rachel') {
            driverFeatures = `
                <!-- Hair -->
                <rect x="75" y="40" width="80" height="120" rx="40" fill="#ffca28" />
                <!-- Pink Headband -->
                <rect x="70" y="55" width="90" height="15" rx="5" fill="#e91e63" />
                <!-- Face -->
                <circle cx="115" cy="100" r="35" fill="#ffe0b2" />
                <!-- Eyes -->
                <circle cx="100" cy="95" r="4" fill="#000" />
                <circle cx="130" cy="95" r="4" fill="#000" />
                <!-- Big Smile -->
                <path d="M 95 110 Q 115 130 135 110 Z" fill="#fff" stroke="#000" stroke-width="1" />
                <!-- Overalls and Pink Shirt -->
                <path d="M 80 130 L 150 130 L 170 200 L 60 200 Z" fill="#f8bbd0" />
                <rect x="90" y="130" width="50" height="70" fill="#1e88e5" />
                <!-- Straps -->
                <line x1="95" y1="130" x2="85" y2="160" stroke="#1e88e5" stroke-width="5" />
                <line x1="135" y1="130" x2="145" y2="160" stroke="#1e88e5" stroke-width="5" />
            `;
        } else if (driver === 'nerd') {
            driverFeatures = `
                <!-- Face -->
                <circle cx="115" cy="110" r="40" fill="#ffdcb6" />
                <!-- Brown Hair -->
                <path d="M 65 80 Q 115 30 165 80 L 175 110 Q 115 50 55 110 Z" fill="#5d4037" />
                <path d="M 75 70 Q 115 40 135 70 Z" fill="#5d4037" />
                <!-- Glasses -->
                <rect x="82" y="92" width="28" height="18" fill="rgba(255,255,255,0.3)" stroke="#111" stroke-width="3" rx="3" />
                <rect x="120" y="92" width="28" height="18" fill="rgba(255,255,255,0.3)" stroke="#111" stroke-width="3" rx="3" />
                <!-- Glasses Bridge & Arms -->
                <line x1="110" y1="101" x2="120" y2="101" stroke="#111" stroke-width="3" />
                <line x1="75" y1="99" x2="82" y2="101" stroke="#111" stroke-width="3" />
                <line x1="148" y1="101" x2="155" y2="99" stroke="#111" stroke-width="3" />
                <!-- Eyes -->
                <circle cx="96" cy="101" r="4" fill="#000" />
                <circle cx="134" cy="101" r="4" fill="#000" />
                <!-- Smile -->
                <path d="M 105 125 Q 115 130 125 125" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" />
            `;
        } else if (driver === 'barbie') {
            driverFeatures = `
                <!-- Blonde Hair Back -->
                <path d="M 65 90 Q 115 30 165 90 L 175 160 Q 115 180 55 160 Z" fill="#ffe082" />
                <!-- Face -->
                <circle cx="115" cy="110" r="40" fill="#ffccbc" />
                <!-- Sunglasses -->
                <rect x="80" y="90" width="30" height="20" fill="#e91e63" rx="5" />
                <rect x="120" y="90" width="30" height="20" fill="#e91e63" rx="5" />
                <!-- Sunglasses Bridge -->
                <line x1="110" y1="100" x2="120" y2="100" stroke="#e91e63" stroke-width="3" />
                <!-- Smile with pink lipstick -->
                <path d="M 105 125 Q 115 135 125 125" fill="#f48fb1" stroke="#e91e63" stroke-width="2" stroke-linecap="round" />
            `;
        }

        return `
            <svg viewBox="0 0 230 230" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                ${driverFeatures}
            </svg>
        `;
    }
}
