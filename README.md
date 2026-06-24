# 🇩🇪 German Tutor Telegram Bot

AI-powered German learning assistant for Telegram, built with Cloudflare Workers.

This bot helps Persian-speaking learners improve their German through grammar correction, vocabulary training, practice exercises, lesson-based quizzes, and AI-powered explanations.

## Features

* ✍️ Grammar and spelling correction (`/check`)
* 📚 Daily German vocabulary with examples (`/vocab`)
* 🧠 AI-generated grammar explanations (`/explain`)
* 📝 Practice exercises with answers (`/practice`)
* 📄 Generate exercises from lesson PDFs and images (`/lesson`)
* 🔄 Automatic daily vocabulary delivery
* ⚙️ Customizable word count and delivery time
* ☁️ Serverless deployment on Cloudflare Workers
* 🤖 Powered by Google Gemini and Cloudflare Workers AI
## 🚀 Deployment

### 1. Create a Cloudflare Worker

Create a new Worker from the Cloudflare Dashboard.

### 2. Copy the Source Code

Replace the default Worker code with the contents of this repository.

### 3. Create a KV Namespace

Create a KV namespace and bind it to your Worker using the following binding name:

```text
AI
```

### 4. Configure Secrets

Add the following secrets:

```text
TELEGRAM_BOT_TOKEN=your_bot_token
GEMINI_API_KEY=your_gemini_api_key
```

### Required Bindings

```text
AI (KV Namespace)
```

### 5. Configure Cron Trigger (Optional)

Add a Cron Trigger if you want automatic daily vocabulary delivery.

### 6. Set Telegram Webhook

```text
https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>
```

### 7. Deploy

Save and deploy the Worker from the Cloudflare Dashboard.

The bot is now ready to use.


## Commands

| Command     | Description                                   |
| ----------- | --------------------------------------------- |
| `/check`    | Correct German sentences and explain mistakes |
| `/explain`  | Explain grammar topics and vocabulary         |
| `/practice` | Generate practice exercises                   |
| `/vocab`    | Get new German vocabulary                     |
| `/lesson`   | Create exercises from lesson materials        |
| `/auto on`  | Enable daily vocabulary delivery              |
| `/auto off` | Disable daily vocabulary delivery             |
| `/settings` | Show current configuration                    |

## Built With

* Cloudflare Workers
* Cloudflare KV
* Telegram Bot API
* Google Gemini 2.5 Flash
* Cloudflare Workers AI (Llama 3.3)

## Designed For

* German learners (A1–A2 and above)
* Persian-speaking students
* Self-study and classroom support
* Daily vocabulary practice and revision

---

📖 **Persian Documentation:** [فارسی](https://github.com/kiaashkan/German-ai-tutor/blob/main/README-FA.md)
