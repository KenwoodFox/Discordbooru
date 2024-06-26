const http = require('http');
const https = require('https');
const fs = require('fs');
require('dotenv').config();

const BOORU_URL = process.env.BOORU_URL || "https://danbooru.donmai.us";
const HOSTNAME = BOORU_URL.split('://')[1] || BOORU_URL;
const BASE_TAGS = process.env.BASE_TAGS || "";
const WEBHOOKS_PATH = process.env.WEBHOOKS_PATH || "/usr/src/app/webhooks.json";

const RATINGS = {
    general: 0,
    g: 0,
    sensitive: 1,
    //Include safe for legacy Danbooru instances
    safe: 1,
    s: 1,
    questionable: 2,
    q: 2,
    explicit: 3,
    e: 3
};

const lib = BOORU_URL.startsWith('https://') ? https : http;

async function pollAPI(path) {
    return new Promise((resolve, reject) => {
        const req = lib.request({
            hostname: HOSTNAME,
            path: path,
            method: 'GET',
            headers: {
                accept: 'application/json',
                "user-agent": 'request'
            }
        },
        res => {
            res.setEncoding('utf8');

            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`Status Code: ${res.statusCode}`));
            }
        
            let resData = "";
        
            res.on('data', chunk => {
                resData += chunk;
            });
        
            res.on('end', () => resolve(JSON.parse(resData)));
        });
    
        req.on('error', reject);
    
        req.end();
    });
}

async function postMessage(path, data) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'discord.com',
            path: '/api/webhooks/'+path,
            method: 'POST',
            headers: {
                "user-agent": 'request',
                "content-type": 'application/json',
                "content-length": data.length
            }
        },
        res => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                return reject(new Error(`Status Code: ${res.statusCode}\nPath: ${path}\nBody: ${data}`));
            }
        
            const resData = [];
        
            res.on('data', chunk => {
                resData.push(chunk);
            });
        
            res.on('end', () => resolve(Buffer.concat(resData).toString()));
        });
    
        req.on('error', reject);
    
        req.write(data);
        req.end();
    });
}

var recentID;
var previousID;

let webhooks;
try {
    webhooks = JSON.parse(fs.readFileSync(WEBHOOKS_PATH, 'utf8'));
} catch (err) {
    console.error('Error reading webhooks file:', err);
    process.exit(1);
}

pollAPI(`/posts.json${BASE_TAGS ? `?tags=${BASE_TAGS}&` : '?'}limit=1`).then((posts) => {
    recentID = posts[0].id;
    console.log(`Starting at ${recentID}`);
    

    setInterval(async () => {
        console.log(`Checking Danbooru starting at ${recentID}`);
        const posts = await pollAPI(`/posts.json?tags=${BASE_TAGS ? BASE_TAGS + '+' : ''}id:%3E=${recentID}`);
        recentID = posts[0].id;

        if (previousID) posts.splice(posts.findIndex(post => { return post.id === previousID }), 1);
        previousID = recentID;

        for (const post of posts) {
            for (const hook of webhooks) {
                if (hook.tags.every(tag => { return post.tag_string.includes(tag) }) && RATINGS[post.rating] <= RATINGS[hook.maxRating] && RATINGS[post.rating] >= RATINGS[hook.minRating]) {
                    console.log(`${post.id} matches ${hook.tags} ${hook.minRating}-${hook.maxRating}`);

                    if (hook.exclusionTags.some(tag => post.tag_string.includes(tag))) {
                        return console.log('Post contains excluded tags');
                    }

                    const body = JSON.stringify({
                        embeds: [{
                            title: `${post.tag_string_character} by ${post.tag_string_artist}`,
                            url: `${BOORU_URL}/posts/${post.id}`,
                            image: { url: post.file_url },
                            timestamp: post.created_at,
                            color: parseInt(hook.color, 16),
                            description: `[Large](${post.large_file_url})`
                        }]
                    });
                    return postMessage(hook.uri, body);
                }
            };
        };
    }, 60_000);
}).catch(console.error);