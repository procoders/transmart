"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const options_1 = require("./options");
const cli_1 = require("./cli");
(0, options_1.parseArgv)(process.argv).then((opts) => {
    if (opts) {
        (0, cli_1.run)(opts).catch((err) => {
            console.error(err);
            process.exitCode = 1;
        });
    }
    else {
        process.exitCode = 2;
    }
});
//# sourceMappingURL=index.js.map