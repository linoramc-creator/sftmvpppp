import {render,screen,waitFor,fireEvent} from '@testing-library/react';
import {BrowserRouter} from 'react-router-dom';
import AuthGate from '@/components/AuthGate';
const fake=vi.hoisted(()=>({getSession:vi.fn(),signInWithOtp:vi.fn(),onAuthStateChange:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:fake}}));
beforeEach(()=>{fake.getSession.mockResolvedValue({data:{session:null}});fake.onAuthStateChange.mockReturnValue({data:{subscription:{unsubscribe:vi.fn()}}});fake.signInWithOtp.mockResolvedValue({error:null});});
it('requires email access before rendering the terminal and has no password input',async()=>{
 const {container}=render(<BrowserRouter><AuthGate><p>Private terminal</p></AuthGate></BrowserRouter>);
 await screen.findByRole('button',{name:'Recibir enlace de acceso'});
 expect(screen.queryByText('Private terminal')).not.toBeInTheDocument();
 expect(container.querySelector('input[type=password]')).toBeNull();
 fireEvent.change(screen.getByRole('textbox',{name:'E-mail'}),{target:{value:'Person@example.com'}});
 fireEvent.click(screen.getByRole('button',{name:'Recibir enlace de acceso'}));
 await waitFor(()=>expect(fake.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({email:'person@example.com'})));
 expect(await screen.findByRole('status')).toHaveTextContent('Revisa tu correo');
});
it('does not display a success message when sending the access email fails',async()=>{
 fake.signInWithOtp.mockResolvedValue({error:{status:429}});
 render(<BrowserRouter><AuthGate><p>Private terminal</p></AuthGate></BrowserRouter>);
 await screen.findByRole('button',{name:'Recibir enlace de acceso'});
 fireEvent.change(screen.getByRole('textbox',{name:'E-mail'}),{target:{value:'person@example.com'}});
 fireEvent.click(screen.getByRole('button',{name:'Recibir enlace de acceso'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Espera unos minutos');
 expect(screen.queryByText(/Revisa tu correo/)).not.toBeInTheDocument();
});
