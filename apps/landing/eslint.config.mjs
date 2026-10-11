import base from "@vouch/config/eslint";

export default [...base, { ignores: [".next/**", "next-env.d.ts"] }];
