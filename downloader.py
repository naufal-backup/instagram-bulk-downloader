import sys
import os
import json
import requests
import urllib.parse
import instaloader
import uuid

PREVIEW_POST_LIMIT = 36

def get_headers(cookies_str, username=""):
    csrf_token = ""
    for c in cookies_str.split(';'):
        if 'csrftoken=' in c:
            parts = c.split('=')
            if len(parts) > 1:
                csrf_token = parts[1].strip()
            break
            
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-IG-App-ID': '936619743392459',
        'X-ASBD-ID': '129477',
        'X-CSRFToken': csrf_token,
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': f'https://www.instagram.com/{username}/' if username else 'https://www.instagram.com/',
        'Cookie': cookies_str
    }

def make_loader():
    return instaloader.Instaloader(
        dirname_pattern=os.path.join(os.path.expanduser("~"), "Pictures", "InstagramDownloads", "{profile}"),
        filename_pattern="{mediaid}",
        download_geotags=False, download_comments=False, save_metadata=False,
        compress_json=False, quiet=True
    )

def parse_cookies(cookies_str):
    cookies_dict = {}
    for cookie in cookies_str.split(';'):
        if '=' in cookie:
            parts = cookie.strip().split('=', 1)
            if len(parts) == 2:
                name = parts[0].strip()
                value = parts[1].strip().strip('"')
                cookies_dict[name] = urllib.parse.unquote(value)
    return cookies_dict

def apply_cookies_to_loader(L, cookies_str):
    cookies_dict = parse_cookies(cookies_str)
    for name, value in cookies_dict.items():
        L.context._session.cookies.set(name, value, domain='.instagram.com')

    my_user_id = cookies_dict.get('ds_user_id')
    if my_user_id:
        L.context.username = my_user_id

    L.context._session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'X-CSRFToken': cookies_dict.get('csrftoken', ''),
        'X-IG-App-ID': '936619743392459',
        'X-ASBD-ID': '129477',
        'Referer': 'https://www.instagram.com/',
    })
    return cookies_dict

def verify_and_setup_session(L, cookies_str):
    cookies_dict = apply_cookies_to_loader(L, cookies_str)

    # Use requests to verify session first
    headers = get_headers(cookies_str)
    # Fetching 'topsearch' or 'web_profile_info' for a random known public profile to check login status
    # Or even better: https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram
    test_url = "https://www.instagram.com/api/v1/users/web_profile_info/?username=instagram"
    res = requests.get(test_url, headers=headers)
    
    if res.status_code != 200:
        return False, f"Session invalid (Status {res.status_code})"

    try:
        data = res.json()
        viewer = data.get('data', {}).get('user', {})
        return True, "Success"
    except Exception as e:
        return False, str(e)

def slide_from_graphql_node(node):
    image_url = node.get('display_url') or node.get('display_src') or ""
    is_video = bool(node.get('is_video'))
    return {
        "id": str(node.get('id') or node.get('shortcode') or uuid.uuid4()),
        "url": image_url,
        "videoUrl": node.get('video_url') or "",
        "type": "video" if is_video else "image"
    }

def post_preview_from_node(node):
    slides = []
    sidecar = node.get('edge_sidecar_to_children', {})
    for edge in sidecar.get('edges', []):
        child = edge.get('node', {})
        slide = slide_from_graphql_node(child)
        if slide.get("url"):
            slides.append(slide)

    if not slides:
        slide = slide_from_graphql_node(node)
        if slide.get("url"):
            slides.append(slide)

    image_url = slides[0]["url"] if slides else node.get('display_url') or node.get('display_src')
    media_id = str(node.get('id') or node.get('shortcode') or uuid.uuid4())
    return {
        "id": media_id,
        "shortcode": node.get('shortcode', ''),
        "url": image_url,
        "videoUrl": slides[0].get("videoUrl", "") if slides else "",
        "type": "carousel" if len(slides) > 1 else ("video" if node.get('is_video') else "image"),
        "slides": slides
    }

def get_posts_from_profile_api(user):
    posts = []
    media = user.get('edge_owner_to_timeline_media', {})
    for edge in media.get('edges', []):
        node = edge.get('node', {})
        item = post_preview_from_node(node)
        if item.get("url"):
            posts.append(item)
    return posts

def slide_from_feed_media(media):
    image_candidates = media.get('image_versions2', {}).get('candidates', [])
    video_versions = media.get('video_versions', [])
    media_type = media.get('media_type')

    image_url = ""
    if image_candidates:
        image_url = image_candidates[0].get('url', '')

    return {
        "id": str(media.get('id') or media.get('pk') or uuid.uuid4()),
        "url": image_url,
        "videoUrl": video_versions[0].get('url') if video_versions else "",
        "type": "video" if media_type == 2 else "image"
    }

def post_preview_from_feed_item(item):
    carousel = item.get('carousel_media', [])
    slides = []
    if carousel:
        for media in carousel:
            slide = slide_from_feed_media(media)
            if slide.get("url"):
                slides.append(slide)
    else:
        slide = slide_from_feed_media(item)
        if slide.get("url"):
            slides.append(slide)

    media_type = item.get('media_type')
    first_slide = slides[0] if slides else {}
    return {
        "id": str(item.get('id') or item.get('pk') or uuid.uuid4()),
        "shortcode": item.get('code', ''),
        "url": first_slide.get("url", ""),
        "videoUrl": first_slide.get("videoUrl", ""),
        "type": "carousel" if len(slides) > 1 or media_type == 8 else ("video" if media_type == 2 else "image"),
        "slides": slides
    }

def get_posts_from_feed_api(user_id, headers):
    posts = []
    next_max_id = None

    while len(posts) < PREVIEW_POST_LIMIT:
        url = f"https://www.instagram.com/api/v1/feed/user/{user_id}/?count=12"
        if next_max_id:
            url += f"&max_id={urllib.parse.quote(str(next_max_id))}"

        res = requests.get(url, headers=headers)
        if res.status_code != 200:
            break

        data = res.json()
        items = data.get('items', [])
        if not items:
            break

        for item in items:
            preview = post_preview_from_feed_item(item)
            if preview.get("url"):
                posts.append(preview)
            if len(posts) >= PREVIEW_POST_LIMIT:
                break

        if not data.get('more_available'):
            break
        next_max_id = data.get('next_max_id')
        if not next_max_id:
            break

    return posts

def get_posts_from_instaloader(L, user_id):
    posts = []
    profile = instaloader.Profile.from_id(L.context, int(user_id))
    for post in profile.get_posts():
        slides = []
        if post.typename == "GraphSidecar":
            for node in post.get_sidecar_nodes():
                slides.append({
                    "id": str(getattr(node, "mediaid", uuid.uuid4())),
                    "url": node.display_url,
                    "videoUrl": getattr(node, "video_url", None) or "",
                    "type": "video" if node.is_video else "image"
                })
        if not slides:
            slides.append({
                "id": str(post.mediaid),
                "url": post.url,
                "videoUrl": post.video_url if post.is_video else "",
                "type": "video" if post.is_video else "image"
            })
        posts.append({
            "id": str(post.mediaid),
            "shortcode": post.shortcode,
            "url": slides[0]["url"],
            "videoUrl": slides[0].get("videoUrl", ""),
            "type": "carousel" if len(slides) > 1 else ("video" if post.is_video else "image"),
            "slides": slides
        })
        if len(posts) >= PREVIEW_POST_LIMIT:
            break
    return posts

def story_preview_from_api_item(item):
    image_candidates = item.get('image_versions2', {}).get('candidates', [])
    video_versions = item.get('video_versions', [])
    media_type = item.get('media_type')
    return {
        "id": str(item.get('id') or item.get('pk') or uuid.uuid4()),
        "url": image_candidates[0].get('url') if image_candidates else "",
        "videoUrl": video_versions[0].get('url') if video_versions else "",
        "type": "video" if media_type == 2 else "image"
    }

def get_highlight_slides(highlight_id, headers):
    slides = []
    reel_id = str(highlight_id)
    if not reel_id.startswith("highlight:"):
        reel_id = f"highlight:{reel_id}"

    h_items_url = f"https://www.instagram.com/api/v1/feed/reels_media/?reel_ids={urllib.parse.quote(reel_id)}"
    h_items_res = requests.get(h_items_url, headers=headers)
    if h_items_res.status_code == 200:
        reels = h_items_res.json().get('reels', {})
        reel = reels.get(reel_id) or reels.get(str(highlight_id)) or {}
        if not reel and reels:
            reel = next(iter(reels.values()), {})
        for item in reel.get('items', []):
            preview = story_preview_from_api_item(item)
            if preview.get("url"):
                slides.append(preview)
    return slides

def get_stories_from_api(user_id, headers):
    stories = []
    s_url = f"https://www.instagram.com/api/v1/feed/reels_media/?reel_ids={user_id}"
    s_res = requests.get(s_url, headers=headers)
    if s_res.status_code == 200:
        reel = s_res.json().get('reels', {}).get(str(user_id), {})
        for item in reel.get('items', []):
            preview = story_preview_from_api_item(item)
            if preview.get("url"):
                stories.append(preview)
    return stories

def get_stories_from_instaloader(L, user_id):
    stories = []
    for story in L.get_stories(userids=[int(user_id)]):
        for item in story.get_items():
            stories.append({
                "id": str(item.mediaid),
                "url": item.url,
                "videoUrl": item.video_url or "",
                "type": "video" if item.is_video else "image"
            })
    return stories

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Missing arguments"}))
        return

    command = sys.argv[1] 
    username = sys.argv[2]
    cookies_str = sys.argv[3]

    if command == 'fetch':
        headers = get_headers(cookies_str, username)
        try:
            L = make_loader()
            verify_and_setup_session(L, cookies_str)

            url = f"https://www.instagram.com/api/v1/users/web_profile_info/?username={username}"
            res = requests.get(url, headers=headers)
            
            if res.status_code != 200:
                print(json.dumps({"error": f"Profile fetch failed ({res.status_code}). Session might be invalid or expired."}))
                return

            data = res.json()
            user = data['data']['user']
            
            posts = []
            try:
                posts = get_posts_from_feed_api(user['id'], headers)
            except Exception:
                posts = []
            if not posts:
                try:
                    posts = get_posts_from_profile_api(user)
                except Exception:
                    posts = []
            if not posts:
                try:
                    posts = get_posts_from_instaloader(L, user['id'])
                except Exception:
                    posts = []

            highlights = []
            h_url = f"https://www.instagram.com/api/v1/highlights/{user['id']}/highlights_tray/"
            h_res = requests.get(h_url, headers=headers)
            if h_res.status_code == 200:
                for h in h_res.json().get('tray', []):
                    highlight_id = h['id']
                    slides = get_highlight_slides(highlight_id, headers)
                    cover = h['cover_media']['cropped_image_version']['url']
                    highlights.append({
                        "id": highlight_id,
                        "title": h['title'],
                        "cover": cover,
                        "url": slides[0]["url"] if slides else cover,
                        "videoUrl": slides[0].get("videoUrl", "") if slides else "",
                        "type": "highlight",
                        "slides": slides
                    })

            stories = get_stories_from_api(user['id'], headers)
            if not stories:
                try:
                    stories = get_stories_from_instaloader(L, user['id'])
                except Exception:
                    stories = []

            print(json.dumps({
                "posts": posts, "highlights": highlights, "stories": stories,
                "userId": user['id'], "is_private": user['is_private'],
                "followed_by_viewer": user.get('followed_by_viewer', False),
                "counts": {
                    "posts": user.get('edge_owner_to_timeline_media', {}).get('count'),
                    "highlights": len(highlights),
                    "stories": len(stories)
                }
            }))
        except Exception as e:
            print(json.dumps({"error": f"Fetch internal error: {str(e)}"}))

    elif command == 'download':
        L = make_loader()
        
        ok, msg = verify_and_setup_session(L, cookies_str)
        if not ok:
            print(json.dumps({"error": f"Login Required: {msg}"}))
            return
            
        try:
            # Safe lookup
            headers = get_headers(cookies_str, username)
            res = requests.get(f"https://www.instagram.com/api/v1/users/web_profile_info/?username={username}", headers=headers)
            if res.status_code == 200:
                user_data = res.json()['data']['user']
                profile = instaloader.Profile.from_id(L.context, int(user_data['id']))
            else:
                profile = instaloader.Profile.from_username(L.context, username)

            target_type = sys.argv[4] if len(sys.argv) > 4 else 'all'
            if target_type == 'posts':
                for post in profile.get_posts(): L.download_post(post, target=profile.username)
            elif target_type == 'stories':
                L.download_stories(userids=[profile.userid])
            elif target_type == 'highlights':
                for highlight in L.get_highlights(profile):
                    for item in highlight.get_items():
                        L.download_post(item, target=f"{profile.username}/highlights")
            else:
                L.download_profiles({profile})
                L.download_stories(userids=[profile.userid])

            print(json.dumps({"status": "success"}))
        except Exception as e:
            print(json.dumps({"error": f"Download error: {str(e)}"}))

if __name__ == "__main__":
    main()
