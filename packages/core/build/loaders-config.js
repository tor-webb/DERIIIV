const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const path = require('path');

const IS_RELEASE =
    process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging' || process.env.NODE_ENV === 'test';

const js_loaders = [
    {
        loader: 'babel-loader',
        options: {
            cacheDirectory: true,
            rootMode: 'upward',
        },
    },
];

const html_loaders = [
    {
        loader: 'html-loader',
    },
];

const file_loaders = [
    {
        loader: 'file-loader',
        options: {
            name: '[path][name].[ext]',
        },
    },
];

const svg_file_loaders = [
    {
        loader: 'file-loader',
        options: {
            name: '[path][name].[contenthash].[ext]',
        },
    },
];

// Prefix SVG ids with the file's path under packages/ so inline SVGs on one page cannot collide,
// even when two files share a name (e.g. settings/left.svg and settings/dark/left.svg, or the
// same file in core and trader).
const getSvgIdPrefix = (_node, info) => {
    if (!info.path) return 'svg';
    return path
        .relative(path.resolve(__dirname, '../..'), info.path)
        .replace(/\.svg$/, '')
        .replace(/[^\w-]/g, '_');
};

const svg_loaders = [
    {
        loader: 'babel-loader',
        options: {
            cacheDirectory: true,
            rootMode: 'upward',
        },
    },
    {
        loader: '@svgr/webpack',
        options: {
            babel: false,
            svgoConfig: {
                floatPrecision: 2,
                plugins: [
                    {
                        name: 'preset-default',
                        params: {
                            overrides: {
                                removeTitle: false,
                                removeUselessStrokeAndFill: false,
                                // Keep viewBox so the SVGs scale when CSS resizes them.
                                removeViewBox: false,
                            },
                        },
                    },
                    { name: 'prefixIds', params: { prefix: getSvgIdPrefix } },
                ],
            },
        },
    },
];

const css_loaders = [
    {
        loader: MiniCssExtractPlugin.loader,
    },
    {
        loader: 'css-loader',
        options: {
            sourceMap: !IS_RELEASE,
            // Block external @import statements from being processed by webpack
            import: url => {
                // Block external URLs (http://, https://, //)
                if (/^https?:\/\//.test(url) || url.startsWith('//')) {
                    return false;
                }
                // Allow all relative and webpack module imports
                return true;
            },
        },
    },
    {
        loader: 'postcss-loader',
        options: {
            sourceMap: !IS_RELEASE,
            postcssOptions: {
                config: path.resolve(__dirname),
            },
        },
    },
    {
        loader: 'resolve-url-loader',
        options: {
            sourceMap: true,
        },
    },
    {
        loader: 'sass-loader',
        options: {
            sourceMap: !IS_RELEASE,
            sassOptions: {
                outputStyle: 'expanded',
            },
        },
    },
    {
        loader: 'sass-resources-loader',
        options: {
            resources: require('@deriv/shared/src/styles/index.js'),
        },
    },
];

module.exports = {
    IS_RELEASE,
    js_loaders,
    html_loaders,
    file_loaders,
    svg_loaders,
    svg_file_loaders,
    css_loaders,
};
