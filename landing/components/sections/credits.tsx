import { Icon } from "../pixel";
import { credits } from "../../lib/content";
import { RELEASE_PAGE_URL, SOURCE_URL } from "../../lib/release-links";
import { CONTACT_EMAIL } from "../../lib/site-constants";
import { Reveal } from "./reveal";
import styles from "./credits.module.css";

export function Credits() {
  return (
    <footer className={styles.footer}>
      <div className={styles.sky} aria-hidden="true" />
      <Reveal>
        <div className={styles.roll}>
          <p className={styles.theEnd}>Thanks for playing</p>
          <dl className={styles.cast}>
            {credits.map((line, index) => (
              <div key={line.role} className={styles.line} style={{ animationDelay: `${index * 160}ms` }}>
                <dt>{line.role}</dt>
                <dd>{line.name}</dd>
              </div>
            ))}
          </dl>
          <nav className={styles.links} aria-label="Project">
            <a href={SOURCE_URL}>
              <Icon name="github" size={1} /> Source on GitHub
            </a>
            <a href={RELEASE_PAGE_URL}>
              <Icon name="flag" size={1} /> Release page
            </a>
            <a href={`mailto:${CONTACT_EMAIL}`}>
              <Icon name="chat" size={1} /> {CONTACT_EMAIL}
            </a>
            <a href="#top">
              <Icon name="arrowUpRight" size={1} /> Continue? Back to title
            </a>
          </nav>
          <p className={styles.fine}>
            Fusion Pixel font by TakWolf, used under the{" "}
            <a href="/fonts/fusion-pixel-licenses/OFL.txt">SIL Open Font License 1.1</a>.
          </p>
          <p className={styles.fine}>© AgentCompany</p>
        </div>
      </Reveal>
    </footer>
  );
}
