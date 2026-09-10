import base from "@vouch/config/eslint";

export default [...base, { ignores: ["src/generated/**"] }];
