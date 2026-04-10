import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import { Text } from 'ink';
export function Badge({ label, color }) {
    return (_jsx(Text, { color: color, bold: true, children: label }));
}
