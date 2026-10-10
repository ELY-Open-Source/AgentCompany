import { Hud, Icon } from "../pixel";
import { nav } from "../../lib/content";
import { SiteMenu } from "./site-menu";
import styles from "./top-bar.module.css";

export function TopBar() {
  return (
    <header className={styles.bar}>
      <a className={styles.brand} href="#top">
        <Icon name="building" size={2} />
        <span>AgentCompany</span>
      </a>
      <nav className={styles.nav} aria-label="Sections">
        {nav.map((link) => (
          <a key={link.href} href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
      <SiteMenu />
      <div className={styles.hud}>
        <Hud />
      </div>
    </header>
  );
}
