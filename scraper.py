import requests
from bs4 import BeautifulSoup
import re
import time
from urllib.parse import quote_plus

class MovieScraper:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
    
    def search_yts(self, query, year=None):
        """Scrape YTS.mx for magnet links (example)"""
        search_url = f"https://yts.mx/browse-movies/{quote_plus(query)}/all/all/0/latest"
        
        try:
            resp = self.session.get(search_url, timeout=15)
            soup = BeautifulSoup(resp.text, 'lxml')
            
            # Find first movie result
            movie_div = soup.find('div', class_='movie-tile')
            if not movie_div:
                return None
            
            # Get download page
            link = movie_div.find('a', href=True)
            if not link:
                return None
            
            detail_url = "https://yts.mx" + link['href']
            detail_resp = self.session.get(detail_url, timeout=15)
            detail_soup = BeautifulSoup(detail_resp.text, 'lxml')
            
            # Extract magnet for 720p
            magnet_tag = detail_soup.find('a', href=re.compile(r'magnet:?'))
            if magnet_tag:
                return {
                    'title': link.get('title', query),
                    'magnet': magnet_tag['href'],
                    'quality': '720p'
                }
        except Exception as e:
            print(f"Scraper error: {e}")
        
        return None
    
    def search_1337x(self, query):
        """Scrape 1337x.to for torrents"""
        search_url = f"https://1337x.to/search/{quote_plus(query)}/1/"
        
        try:
            resp = self.session.get(search_url, timeout=15)
            soup = BeautifulSoup(resp.text, 'lxml')
            
            # Get first result
            row = soup.find('tr')
            if not row:
                return None
            
            name_tag = row.find('a', class_='name')
            if not name_tag:
                return None
            
            magnet_link = row.find('a', href=re.compile(r'magnet:?'))
            if magnet_link:
                return {
                    'title': name_tag.text.strip(),
                    'magnet': magnet_link['href'],
                    'quality': '1080p'
                }
        except Exception as e:
            print(f"1337x error: {e}")
        
        return None
    
    def get_download_link(self, query):
        """Try multiple sources"""
        # Try YTS first
        result = self.search_yts(query)
        if result:
            return result
        
        # Try 1337x as fallback
        result = self.search_1337x(query)
        if result:
            return result
        
        return None
