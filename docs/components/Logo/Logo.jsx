import { asset } from '../../lib/site'

function Logo() {
  return (
    <img
      src={asset('/img/logos/notoriun-dark.svg')}
      alt="Notoriun"
      style={{ height: 20, width: 'auto' }}
    />
  )
}

export default Logo
