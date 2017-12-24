/// <reference path="./layoutView.ts" />

namespace pxsim {
    export const GAME_LOOP_FPS = 32;
}

namespace pxsim.visuals {

    const EV3_STYLE = `
        svg.sim {
            margin-bottom:1em;
        }
        svg.sim.grayscale {
            -moz-filter: grayscale(1);
            -webkit-filter: grayscale(1);
            filter: grayscale(1);
        }
        .sim-button {
            cursor: pointer;
        }
        .sim-button:hover {
            stroke-width: 2px !important;
            stroke: white !important;
        }

        .sim-systemled {
            fill:#333;
            stroke:#555;
            stroke-width: 1px;
        }

        .sim-text {
            font-family:"Lucida Console", Monaco, monospace;
            font-size:8px;
            fill:#fff;
            pointer-events: none; user-select: none;
        }
        .sim-text.small {
            font-size:6px;
        }
        .sim-text.inverted {
            fill:#000;
        }

        /* Color Grid */
        .sim-color-grid-circle:hover {
            stroke-width: 0.4;
            stroke: #000;
            cursor: pointer;
        }
        .sim-color-wheel-half:hover {
            stroke-width: 1;
            stroke: #000;
            fill: gray !important;
            cursor: pointer;
        }
    `;

    const EV3_WIDTH = 99.984346;
    const EV3_HEIGHT = 151.66585;
    export const SCREEN_WIDTH = 178;
    export const SCREEN_HEIGHT = 128;
    export interface IBoardTheme {
        accent?: string;
        display?: string;
        buttonOuter?: string;
        buttonUps: string[];
        buttonDown?: string;
    }

    export var themes: IBoardTheme[] = ["#3ADCFE"].map(accent => {
        return {
            accent: accent,
            buttonOuter: "#979797",
            buttonUps: ["#a8aaa8", "#393939", "#a8aaa8", "#a8aaa8", "#a8aaa8", '#a8aaa8'],
            buttonDown: "#000"
        }
    });

    export function randomTheme(): IBoardTheme {
        return themes[Math.floor(Math.random() * themes.length)];
    }

    export interface IBoardProps {
        runtime?: pxsim.Runtime;
        theme?: IBoardTheme;
        disableTilt?: boolean;
        wireframe?: boolean;
    }

    export class EV3View implements BoardView {
        public static BOARD_WIDTH = 500;
        public static BOARD_HEIGHT = 500;

        public wrapper: HTMLDivElement;
        public element: SVGSVGElement;
        private style: SVGStyleElement;
        private defs: SVGDefsElement;

        private layoutView: LayoutView;

        private cachedControlNodes: { [index: string]: View[] } = {};
        private cachedDisplayViews: { [index: string]: LayoutElement[] } = {};

        private screenCanvas: HTMLCanvasElement;
        private screenCanvasCtx: CanvasRenderingContext2D;
        private screenCanvasData: ImageData;

        private screenCanvasTemp: HTMLCanvasElement;

        private screenScaledWidth: number;
        private screenScaledHeight: number;

        private width = 0;
        private height = 0;

        private g: SVGGElement;

        public board: pxsim.EV3Board;

        constructor(public props: IBoardProps) {
            this.buildDom();
            const dalBoard = board();
            dalBoard.updateSubscribers.push(() => this.updateState());
            if (props && props.wireframe)
                svg.addClass(this.element, "sim-wireframe");

            if (props && props.theme)
                this.updateTheme();

            if (props && props.runtime) {
                this.board = this.props.runtime.board as pxsim.EV3Board;
                this.board.updateSubscribers.push(() => this.updateState());
                this.updateState();
            }

            Runtime.messagePosted = (msg) => {
                switch (msg.type || "") {
                    case "status": {
                        const state = (msg as pxsim.SimulatorStateMessage).state;
                        if (state == "killed") this.kill();
                        if (state == "running") this.begin();
                        break;
                    }
                }
            }
        }

        public getView(): SVGAndSize<SVGSVGElement> {
            return {
                el: this.wrapper as any,
                y: 0,
                x: 0,
                w: EV3View.BOARD_WIDTH,
                h: EV3View.BOARD_WIDTH
            };
        }

        public getCoord(pinNm: string): Coord {
            // Not needed
            return undefined;
        }

        public highlightPin(pinNm: string): void {
            // Not needed
        }

        public getPinDist(): number {
            // Not needed
            return 10;
        }

        public updateTheme() {
            let theme = this.props.theme;
            this.layoutView.updateTheme(theme);
        }

        private getControlForNode(id: NodeType, port: number) {
            if (this.cachedControlNodes[id] && this.cachedControlNodes[id][port]) {
                return this.cachedControlNodes[id][port];
            }

            let view: View;
            switch (id) {
                case NodeType.ColorSensor: {
                    const state = ev3board().getInputNodes()[port] as ColorSensorNode;
                    if (state.getMode() == ColorSensorMode.Colors) {
                        view = new ColorGridControl(this.element, this.defs, state, port);
                    } else if (state.getMode() == ColorSensorMode.Reflected) {
                        view = new ColorWheelControl(this.element, this.defs, state, port);
                    } else if (state.getMode() == ColorSensorMode.Ambient) {
                        view = new ColorWheelControl(this.element, this.defs, state, port);
                    }
                    break;
                }
                case NodeType.UltrasonicSensor: {
                    const state = ev3board().getInputNodes()[port] as UltrasonicSensorNode;
                    view = new DistanceSliderControl(this.element, this.defs, state, port);
                    break;
                }
                case NodeType.GyroSensor: {
                    const state = ev3board().getInputNodes()[port] as GyroSensorNode;
                    view = new RotationSliderControl(this.element, this.defs, state, port);
                    break;
                }
                case NodeType.MediumMotor:
                case NodeType.LargeMotor: {
                    // const state = ev3board().getMotor(port)[0];
                    // view = new MotorInputControl(this.element, this.defs, state, port);
                    // break;
                }
            }

            if (view) {
                if (!this.cachedControlNodes[id]) this.cachedControlNodes[id] = [];
                this.cachedControlNodes[id][port] = view;
                return view;
            }

            return undefined;
        }

        private getDisplayViewForNode(id: NodeType, port: number): LayoutElement {
            if (this.cachedDisplayViews[id] && this.cachedDisplayViews[id][port]) {
                return this.cachedDisplayViews[id][port];
            }

            let view: LayoutElement;
            switch (id) {
                case NodeType.TouchSensor:
                    view = new TouchSensorView(port); break;
                case NodeType.MediumMotor:
                    view = new MediumMotorView(port); break;
                case NodeType.LargeMotor:
                    view = new LargeMotorView(port); break;
                case NodeType.GyroSensor:
                    view = new GyroSensorView(port); break;
                case NodeType.ColorSensor:
                    view = new ColorSensorView(port); break;
                case NodeType.UltrasonicSensor:
                    view = new UltrasonicSensorView(port); break;
                case NodeType.Brick:
                    //return new BrickView(0);
                    view = this.layoutView.getBrick(); break;
            }

            if (view) {
                if (!this.cachedDisplayViews[id]) this.cachedDisplayViews[id] = [];
                this.cachedDisplayViews[id][port] = view;
                return view;
            }

            return undefined;
        }

        private getCloseIconView() {
            return new CloseIconControl(this.element, this.defs, new PortNode(-1), -1);
        }

        private buildDom() {
            this.wrapper = document.createElement('div');
            this.wrapper.style.display = 'inline';

            this.element = svg.elt("svg", { height: "100%", width: "100%" }) as SVGSVGElement;

            this.defs = svg.child(this.element, "defs") as SVGDefsElement;

            this.style = svg.child(this.element, "style", {}) as SVGStyleElement;
            this.style.textContent = EV3_STYLE;

            this.layoutView = new LayoutView();
            this.layoutView.inject(this.element);

            // Add EV3 module element
            this.layoutView.setBrick(new BrickView(-1));

            this.resize();

            // Add Screen canvas to board
            this.buildScreenCanvas();

            this.wrapper.appendChild(this.element);
            this.wrapper.appendChild(this.screenCanvas);
            this.wrapper.appendChild(this.screenCanvasTemp);

            window.addEventListener("resize", e => {
                this.resize();
            });
        }

        public resize() {
            if (!this.element) return;
            this.width = document.body.offsetWidth;
            this.height = document.body.offsetHeight;
            this.layoutView.layout(this.width, this.height);

            this.updateState();
            let state = ev3board().screenState;
            this.updateScreenStep(state);
        }

        private buildScreenCanvas() {
            this.screenCanvas = document.createElement("canvas");
            this.screenCanvas.id = "board-screen-canvas";
            this.screenCanvas.style.position = "absolute";
            this.screenCanvas.style.cursor = "crosshair";
            this.screenCanvas.onmousemove = (e: MouseEvent) => {
                const x = e.clientX;
                const y = e.clientY;
                const bBox = this.screenCanvas.getBoundingClientRect();
                this.updateXY(Math.floor((x - bBox.left) / this.screenScaledWidth * SCREEN_WIDTH),
                    Math.floor((y - bBox.top) / this.screenScaledHeight * SCREEN_HEIGHT));
            }
            this.screenCanvas.onmouseleave = () => {
                this.updateXY(SCREEN_WIDTH, SCREEN_HEIGHT);
            }

            this.screenCanvas.width = SCREEN_WIDTH;
            this.screenCanvas.height = SCREEN_HEIGHT;

            this.screenCanvasCtx = this.screenCanvas.getContext("2d");

            this.screenCanvasTemp = document.createElement("canvas");
            this.screenCanvasTemp.style.display = 'none';
        }

        private kill() {
            this.running = false;
            if (this.lastAnimationIds.length > 0) {
                this.lastAnimationIds.forEach(animationId => {
                    cancelAnimationFrame(animationId);
                })
            }
        }

        private begin() {
            this.running = true;
            this.updateState();
        }

        private running: boolean = false;
        private lastAnimationIds: number[] = [];
        public updateState() {
            if (this.lastAnimationIds.length > 0) {
                this.lastAnimationIds.forEach(animationId => {
                    cancelAnimationFrame(animationId);
                })
            }
            if (!this.running) return;
            const fps = GAME_LOOP_FPS;
            let now;
            let then = Date.now();
            let interval = 1000 / fps;
            let delta;
            let that = this;
            function loop() {
                const animationId = requestAnimationFrame(loop);
                that.lastAnimationIds.push(animationId);
                now = Date.now();
                delta = now - then;
                if (delta > interval) {
                    then = now;
                    that.updateStateStep(delta);
                }
            }
            loop();
        }

        private updateStateStep(elapsed: number) {
            const inputNodes = ev3board().getInputNodes();
            inputNodes.forEach((node, index) => {
                node.updateState(elapsed);
                const view = this.getDisplayViewForNode(node.id, index);
                if (!node.didChange() && !view.didChange()) return;
                if (view) {
                    const control = view.getSelected() ? this.getControlForNode(node.id, index) : undefined;
                    const closeIcon = control ? this.getCloseIconView() : undefined;
                    this.layoutView.setInput(index, view, control, closeIcon);
                    view.updateState();
                    if (control) control.updateState();
                }
            });

            const brickNode = ev3board().getBrickNode();
            if (brickNode.didChange()) {
                this.getDisplayViewForNode(brickNode.id, -1).updateState();
            }

            const outputNodes = ev3board().getMotors();
            outputNodes.forEach((node, index) => {
                node.updateState(elapsed);
                const view = this.getDisplayViewForNode(node.id, index);
                if (!node.didChange() && !view.didChange()) return;
                if (view) {
                    const control = view.getSelected() ? this.getControlForNode(node.id, index) : undefined;
                    const closeIcon = control ? this.getCloseIconView() : undefined;
                    this.layoutView.setOutput(index, view, control, closeIcon);
                    view.updateState();
                    if (control) control.updateState();
                }
            });

            let state = ev3board().screenState;
            if (state.didChange()) {
                this.updateScreenStep(state);
            }
        }

        private updateScreenStep(state: EV3ScreenState) {
            const bBox = this.layoutView.getBrick().getScreenBBox();
            if (!bBox || bBox.width == 0) return;

            const scale = (bBox.width - 4) / SCREEN_WIDTH;
            this.screenScaledWidth = (bBox.width - 4);
            this.screenScaledHeight = this.screenScaledWidth / SCREEN_WIDTH * SCREEN_HEIGHT;

            this.screenCanvas.style.top = `${bBox.top + 2}px`;
            this.screenCanvas.style.left = `${bBox.left + 2}px`;
            this.screenCanvas.width = this.screenScaledWidth;
            this.screenCanvas.height = this.screenScaledHeight;

            this.screenCanvasData = this.screenCanvasCtx.getImageData(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

            let sp = 3
            const points = state.points
            const data = this.screenCanvasData.data
            for (let i = 0; i < points.length; ++i) {
                data[sp] = points[i]
                sp += 4;
            }

            // Move the image to another canvas element in order to scale it
            this.screenCanvasTemp.style.width = `${SCREEN_WIDTH}`;
            this.screenCanvasTemp.style.height = `${SCREEN_HEIGHT}`;

            this.screenCanvasTemp.getContext("2d").putImageData(this.screenCanvasData, 0, 0);

            this.screenCanvasCtx.scale(scale, scale);
            this.screenCanvasCtx.drawImage(this.screenCanvasTemp, 0, 0);
        }

        private updateXY(width: number, height: number) {
            const screenWidth = Math.max(0, Math.min(SCREEN_WIDTH, width));
            const screenHeight = Math.max(0, Math.min(SCREEN_HEIGHT, height));
            console.log(`width: ${screenWidth}, height: ${screenHeight}`);

            // TODO: add a reporter for the hovered XY position
        }
    }
}