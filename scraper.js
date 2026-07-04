const axios = require('axios');
const cheerio = require('cheerio');

class MovieScraper {
  constructor() {
    this.client = axios.create({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 15000
    });
  }

  async searchYts(query) {
    try {
      const searchUrl = `https://yts.mx/browse-movies/${encodeURIComponent(query)}/all/all/0/latest`;
      const response = await this.client.get(searchUrl);
      const $ = cheerio.load(response.data);

      const movieTile = $('.movie-tile').first();
      if (!movieTile.length) return null;

      const link = movieTile.find('a').first();
      if (!link.attr('href')) return null;

      const detailUrl = `https://yts.mx${link.attr('href')}`;
      const detailResponse = await this.client.get(detailUrl);
      const $$ = cheerio.load(detailResponse.data);

      const magnetTag = $$('a[href^="magnet:?"]').first();
      if (magnetTag.length) {
        return {
          title: link.text().trim() || query,
          magnet: magnetTag.attr('href'),
          quality: '720p'
        };
      }
    } catch (error) {
      console.error('YTS error:', error.message);
    }
    return null;
  }

  async search1337x(query) {
    try {
      const searchUrl = `https://1337x.to/search/${encodeURIComponent(query)}/1/`;
      const response = await this.client.get(searchUrl);
      const $ = cheerio.load(response.data);

      const row = $('tr').first();
      if (!row.length) return null;

      const nameTag = row.find('a.name').first();
      if (!nameTag.length) return null;

      const magnetLink = row.find('a[href^="magnet:?"]').first();
      if (magnetLink.length) {
        return {
          title: nameTag.text().trim(),
          magnet: magnetLink.attr('href'),
          quality: '1080p'
        };
      }
    } catch (error) {
      console.error('1337x error:', error.message);
    }
    return null;
  }

  async getDownloadLink(query) {
    let result = await this.searchYts(query);
    if (result) return result;
    result = await this.search1337x(query);
    if (result) return result;
    return null;
  }
}

module.exports = { MovieScraper };
