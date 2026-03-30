use spin_sdk::http::{IntoResponse, Method, Request, Response, send};
use spin_sdk::http_component;
use url::Url;
use image::{DynamicImage, RgbaImage, Rgba};
use font8x8::UnicodeFonts;
use rasciify::character::CharacterType;
use rasciify::types::SettingOption;
use rasciify::img_to_img::{grayscale_to_ascii_img, rgb_to_rgb_ascii_img};
use std::io::Cursor;

/// Render a single ASCII character as an 8x8 bitmap using font8x8.
fn get_glyph(ch: char) -> [u8; 8] {
    if (ch as u32) < 128 {
        font8x8::BASIC_FONTS
            .get(ch)
            .unwrap_or([0u8; 8])
    } else {
        [0u8; 8]
    }
}

/// Render ASCII art text into a PNG image.
/// Each character is drawn as an 8x8 glyph, scaled so the output matches
/// the original image dimensions.
fn ascii_to_png(ascii_art: &str, orig_width: u32, orig_height: u32) -> anyhow::Result<Vec<u8>> {
    let lines: Vec<&str> = ascii_art.lines().collect();
    let rows = lines.len() as u32;
    let cols = lines.iter().map(|l| l.len()).max().unwrap_or(0) as u32;

    if rows == 0 || cols == 0 {
        anyhow::bail!("ASCII art is empty");
    }

    // Native resolution of the ASCII grid (8px per glyph)
    let native_w = cols * 8;
    let native_h = rows * 8;

    // We'll render at native glyph resolution, then resize to match original
    let mut img = RgbaImage::from_pixel(native_w, native_h, Rgba([0, 0, 0, 255]));

    for (row_idx, line) in lines.iter().enumerate() {
        for (col_idx, ch) in line.chars().enumerate() {
            let glyph = get_glyph(ch);
            let base_x = (col_idx as u32) * 8;
            let base_y = (row_idx as u32) * 8;

            for (gy, &glyph_row) in glyph.iter().enumerate() {
                for gx in 0..8u32 {
                    if (glyph_row >> gx) & 1 == 1 {
                        let px = base_x + gx;
                        let py = base_y + gy as u32;
                        if px < native_w && py < native_h {
                            img.put_pixel(px, py, Rgba([255, 255, 255, 255]));
                        }
                    }
                }
            }
        }
    }

    // Resize to match original image dimensions
    let resized = image::imageops::resize(
        &img,
        orig_width,
        orig_height,
        image::imageops::FilterType::Lanczos3,
    );

    // Encode as PNG
    let mut buf = Cursor::new(Vec::new());
    let dynamic = DynamicImage::ImageRgba8(resized);
    dynamic.write_to(&mut buf, image::ImageFormat::Png)?;
    Ok(buf.into_inner())
}

#[http_component]
async fn handle_image_processor(req: Request) -> anyhow::Result<impl IntoResponse> {
    // Only accept GET requests
    if *req.method() != Method::Get {
        return Ok(Response::builder()
            .status(405)
            .header("content-type", "text/plain")
            .body("Method not allowed")
            .build());
    }

    // Get the full URL from the spin-full-url header
    let full_url = req
        .header("spin-full-url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing spin-full-url header"))?;

    let parsed = Url::parse(full_url)?;

    // Extract the `img` query parameter
    let img_url = parsed
        .query_pairs()
        .find(|(key, _)| key == "img")
        .map(|(_, value)| value.to_string())
        .ok_or_else(|| anyhow::anyhow!("Missing 'img' query parameter. Usage: /ascii?img=<url>"))?;

    println!("Fetching image from: {}", img_url);

    // Fetch the image from the provided URL
    let outbound_req = Request::builder()
        .method(Method::Get)
        .uri(&img_url)
        .build();

    let resp: Response = send(outbound_req).await?;
    let status = *resp.status();

    if status != 200 {
        return Ok(Response::builder()
            .status(502)
            .header("content-type", "text/plain")
            .body(format!("Upstream returned status {}", status))
            .build());
    }

    let image_bytes = resp.into_body();

    // Decode the image
    let img = image::load_from_memory(&image_bytes)
        .map_err(|e| anyhow::anyhow!("Failed to decode image: {}", e))?;

    let orig_width = img.width();
    let orig_height = img.height();

    println!("Image decoded: {}x{}", orig_width, orig_height);

    // Extract the `model` query parameter (default: "artem")
    let model = parsed
        .query_pairs()
        .find(|(key, _)| key == "model")
        .map(|(_, value)| value.to_string())
        .unwrap_or_else(|| "artem".to_string());

    // Extract the `charset` query parameter for rasciify (default: "default")
    let charset = parsed
        .query_pairs()
        .find(|(key, _)| key == "charset")
        .map(|(_, value)| value.to_string())
        .unwrap_or_else(|| "default".to_string());

    // Extract `color` query parameter (default: true for rasciify)
    let use_color = parsed
        .query_pairs()
        .find(|(key, _)| key == "color")
        .map(|(_, value)| value != "false" && value != "0")
        .unwrap_or(true);

    let png_bytes = match model.as_str() {
        "rasciify" => {
            println!("Using rasciify with charset={}, color={}", charset, use_color);

            let character_type = match charset.as_str() {
                "hiragana" => CharacterType::JpHiragana,
                "katakana" => CharacterType::JpKatakana,
                "chinese" | "chinese_simplified" => CharacterType::ZhSimplified,
                "chinese_traditional" => CharacterType::ZhTraditional,
                "bar" => CharacterType::Bar,
                _ => CharacterType::Simple,
            };

            // Compute number of columns — aim for a reasonable width
            let num_cols = (orig_width / 4).max(80).min(300);

            let output_img = if use_color {
                let buf = rgb_to_rgb_ascii_img(
                    &img,
                    character_type,
                    SettingOption::rgb(num_cols),
                );
                DynamicImage::ImageRgba8(buf)
            } else {
                let buf = grayscale_to_ascii_img(
                    &img,
                    character_type,
                    SettingOption::grayscale(num_cols),
                );
                DynamicImage::ImageLuma8(buf)
            };

            let mut buf = Cursor::new(Vec::new());
            output_img.write_to(&mut buf, image::ImageFormat::Png)?;
            buf.into_inner()
        }
        _ => {
            // Default: use artem
            println!("Using artem");

            let config = artem::config::ConfigBuilder::new().build();
            let ascii_art = artem::convert(img, &config);

            println!("ASCII art generated: {} lines", ascii_art.lines().count());

            ascii_to_png(&ascii_art, orig_width, orig_height)?
        }
    };

    Ok(Response::builder()
        .status(200)
        .header("content-type", "image/png")
        .body(png_bytes)
        .build())
}
