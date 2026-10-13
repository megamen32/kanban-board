export const todoPreview = {
  title: 'Todo — задачи и проекты',
  description: 'Общая доска задач: проекты, исполнители, сроки и результаты работы. Вход через единый аккаунт.',
  url: 'https://todo.bezrabotnyi.com/',
  image: 'https://todo.bezrabotnyi.com/todo-preview.png',
};

/** Static crawler document: never imports authentication or reads board data. */
export function publicPreviewHtml() {
  const { title, description, url, image } = todoPreview;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${description}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${url}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"></head><body><h1>${title}</h1><p>${description}</p><a href="${url}">Войти на доску</a></body></html>`;
}
